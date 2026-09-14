// What a labor is worth: the gate, tag ladder, location cut, and tools. Single source for the Move modal's LABOR kind (bot/src/events/interactionCreate.js), the auto-labor pass (db/lib/autoLaborPass.js) and the Labor? button (db/lib/locationAnchorRow.js). resolveLaborRateFrom scores every tag held and pays the best, so holding several never costs a day. See docs/systemdocs/LABORING.md.
// Same pure-rules/async-context split as db/lib/narrowcastAccess.js, needed because the auto-labor pass resolves Labor for the whole idle roster in one bulk pass rather than one round trip per character.
const { computeRate, SPECIALISATION_KINDS } = require("./production");
const { INCAPACITATING_SLUGS } = require("./incapacitation");
const { isRefinery, refineryInput, REFINERY_YIELD } = require("./refinery");
const { LIFEWEB_SPUTTER_THRESHOLD } = require("./lifeweb");
const { structuresAt } = require("./structures");
const {
  EXHAUSTED_SLUG,
  LABORING_TIRELESS_SLUG,
  LABORING_BASIC_SLUG,
  LABORING_SKILLED_SLUG,
  LABORING_FARMING_SLUG,
  LABORING_HUNTING_SLUG,
  LABORING_FISHING_SLUG,
  LABORING_PROSPECTING_SLUG,
  LAZY_SLUG,
} = require("./constants");

// Lazy cuts a quarter off whatever Resources actually landed, applied AFTER the roll (not a change to the rolled range). 0.75 is Bascinet's number.
const LAZY_YIELD_FACTOR = 0.75;

// Rounds a rolled Resource value down for a Lazy holder; passes everything else through unchanged. `heldSlugs` may be a Set or an array.
function lazyYield(value, heldSlugs) {
  if (value == null) return value;
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  if (!held.has(LAZY_SLUG)) return value;
  return Math.max(0, Math.floor(value * LAZY_YIELD_FACTOR));
}

// Scales the STORED expression the same way lazyYield scales the rolled value, so the printed range matches the payout range rather than showing the pre-cut range with a below-range value (floor(0.75·v) <= floor(0.75·max) for every v <= max keeps them consistent). Only the plain MACHINE "min-max" shape is scaled; anything else is returned unchanged rather than guessed at.
function lazyExpression(expression, heldSlugs) {
  if (!expression) return expression;
  const held = heldSlugs instanceof Set ? heldSlugs : new Set(heldSlugs ?? []);
  if (!held.has(LAZY_SLUG)) return expression;
  const match = /^(\d+)-(\d+)$/.exec(expression);
  if (!match) return expression;
  const [, min, max] = match;
  return `${Math.floor(Number(min) * LAZY_YIELD_FACTOR)}-${Math.floor(Number(max) * LAZY_YIELD_FACTOR)}`;
}

// Soft Hands halves what you make, rounded down, AFTER tools: a Soft-Handed hunter with a Longbow goes 0-18 -> 3-21 -> 1-10. Basic (0-2) floors to 0-1, the intended sting.
const SOFT_HANDS_SLUG = "soft-hands";

// Tag group every weapon lives in. Weapon bonuses do NOT stack — a Longbow and a Crossbow mean hunting with one, not both — so only the best-paying weapon counts; everything else (Trapping Gear, Plow, Fishing Rod, Butcher) still sums.
const WEAPON_GROUP = "items-weapons";

// What Lifeweb failure does to a day's work: below the sputter threshold Basic labor stops entirely rather than scaling, because 5% of "you can sometimes provide for yourself" is nothing with extra steps.
const LIFEWEB_FAILURE_MULTIPLIER = 0.05;

// Two general tiers, best first. No `base` rung: holding neither tag labors for nothing, which is not the same as being refused (see the "unskilled" return in resolveLaborRateFrom).
const GENERAL_TIERS = [
  { slug: LABORING_SKILLED_SLUG, tier: "skilled" },
  { slug: LABORING_BASIC_SLUG, tier: "basic" },
];

// Four side-grades. Each needs its own tag AND a matching LocationYield row at the character's Location — the row IS the gate, which is why no Location carries a "wilderness"/"water" flag.
const SPECIALISATIONS = [
  { slug: LABORING_HUNTING_SLUG, tier: "hunting" },
  { slug: LABORING_FARMING_SLUG, tier: "farming" },
  { slug: LABORING_FISHING_SLUG, tier: "fishing" },
  { slug: LABORING_PROSPECTING_SLUG, tier: "prospecting" },
];

// Loads everything the rules need for one character: tags held, location, its yields, and structures built there.
async function buildLaborContext(prisma, characterId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      locationId: true,
      location: {
        select: { name: true, attributes: true, yields: { select: { kind: true, current: true } } },
      },
    },
  });
  const [tags, structures] = await Promise.all([
    prisma.characterTag.findMany({
      where: { characterId },
      select: {
        equipped: true,
        tag: { select: { slug: true, name: true, group: true, laborBonus: true } },
      },
    }),
    // COMPLETE only — same reading as equipmentReach.js: a half-built or damaged weir catches nothing, which is what gives Damage teeth.
    structuresAt(prisma, character?.locationId, { statuses: ["COMPLETE"] }),
  ]);

  const ctx = {
    locationName: character?.location?.name ?? null,
    yields: yieldMap(character?.location?.yields ?? []),
    refinery: isRefinery(character?.location),
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
    tools: [...toolsFrom(tags), ...structureTools(structures)],
  };
  // Only asked when relevant — 56 of 57 Locations aren't a refinery. The auto-labor pass never comes through here: it hand-builds ctx from one bulk query (db/lib/autoLaborPass.js) and calls resolveLaborRateFrom directly.
  if (ctx.refinery) {
    ctx.refineryInput = await refineryInput(prisma, {
      id: characterId,
      locationId: character?.locationId ?? null,
    });
  }
  return ctx;
}

// LocationYield rows -> { HUNTING: 0.5, ... }. A kind absent from the map cannot be worked here at all.
function yieldMap(rows) {
  const map = {};
  for (const row of rows) map[row.kind] = row.current;
  return map;
}

// Pulls laborBonus entries off a character's tags. Kept flat rather than summed per kind, so the DM can name each tool that paid.
function toolsFrom(tagRows) {
  const tools = [];
  for (const row of tagRows) {
    const bonus = row.tag?.laborBonus;
    if (!bonus || !bonus.kind || !bonus.amount) continue;
    tools.push({
      name: row.tag.name ?? row.tag.slug,
      kind: String(bonus.kind).toLowerCase(),
      amount: Number(bonus.amount) || 0,
      // Default true: nearly every tool is carried; the two that aren't (Plow, Butcher) say so explicitly.
      needsEquipped: bonus.equipped !== false,
      requiresTag: bonus.requiresTag ?? null,
      equipped: row.equipped === true,
      isWeapon: row.tag?.group === WEAPON_GROUP,
    });
  }
  return tools;
}

// Structures pay everyone standing at their Location, as synthetic tools beside toolsFrom's — never equipped, never a weapon (sums like every other non-weapon tool), and named via the same formatLaborBonusNote path. NON-STACKING: one bonus per kind, the best one — two hunting structures on one ground pay like the better of the two, so a location-wide bonus can't multiply by occupancy; ties keep the older structure since structuresAt orders by (createdAt, id). `structures` is structuresAt output (rows carrying .placement), already filtered to COMPLETE by the caller.
function structureTools(structures) {
  const bestByKind = new Map();
  for (const s of structures ?? []) {
    const bonus = s.placement?.laborBonus;
    if (!bonus || !bonus.kind || !bonus.amount) continue;
    const kind = String(bonus.kind).toLowerCase();
    const amount = Number(bonus.amount) || 0;
    const best = bestByKind.get(kind);
    if (best && best.amount >= amount) continue;
    bestByKind.set(kind, {
      name: s.type?.name ?? s.typeName,
      kind,
      amount,
      needsEquipped: false,
      requiresTag: null,
      equipped: false,
      isWeapon: false,
    });
  }
  return [...bestByKind.values()];
}

// { ok: true } or { ok: false, reason }. Only Exhausted refuses — Tired doesn't (db/lib/laborFatigue.js); the payout steps a character up that ladder (db/lib/moveEffects.js), and this reads Exhausted back until the expiry sweep degrades it to Tired.
function computeLaborAccess(ctx) {
  // Laboring (Tireless) works through Exhausted at half yield (applied with Soft Hands below); without the tag, hard stop.
  if (ctx.tagSlugs.has(EXHAUSTED_SLUG) && !ctx.tagSlugs.has(LABORING_TIRELESS_SLUG)) {
    return { ok: false, reason: "You're **Exhausted**. Rest before you can Labor again." };
  }
  // Tied up, bleeding out, on the floor, or out cold. Shared by manual Labor declaration and the Factory's production tiers; the auto-labor pass has its own check since it never calls this function. Only LABOR is blocked — a Routine/Gambit like "I work at the ropes" while bound is a legitimate move for a GM to judge.
  const blocked = [...ctx.tagSlugs].find((slug) => INCAPACITATING_SLUGS.has(slug));
  if (blocked) {
    return { ok: false, reason: "You can't work" };
  }
  return { ok: true };
}

// Does this character hold any Laboring tag? One caller: the auto-labor pass, deciding whether an unfiled day is worth filing. Nothing else gates on this — a skill-less character labors for nothing (resolveLaborRateFrom's "unskilled" tier).
function canLaborAtAll(ctx) {
  return GENERAL_TIERS.some((t) => ctx.tagSlugs.has(t.slug));
}

// Every tool paying into one kind, honouring `equipped`/`requiresTag`. Non-weapons sum; weapons don't — only the best-paying weapon counts, so a second bow is dead weight. Ties keep the first, stable because tag rows come back in a fixed order.
function toolsFor(ctx, tier) {
  const eligible = (ctx.tools ?? []).filter((tool) => {
    if (tool.kind !== tier) return false;
    if (tool.needsEquipped && !tool.equipped) return false;
    if (tool.requiresTag) {
      const required = Array.isArray(tool.requiresTag) ? tool.requiresTag : [tool.requiresTag];
      if (!required.some((slug) => ctx.tagSlugs.has(slug))) return false;
    }
    return true;
  });

  const bestWeapon = eligible
    .filter((tool) => tool.isWeapon)
    .reduce((best, tool) => (best && best.amount >= tool.amount ? best : tool), null);

  return eligible.filter((tool) => !tool.isWeapon || tool === bestWeapon);
}

// Scores one tier into a full candidate, or null if unworkable here. `locationCoefficient` is 1 for the general tiers, which is what makes them uniform everywhere.
function scoreCandidate(ctx, tier, coefficient, locationCoefficient) {
  const rate = computeRate("labor", tier, coefficient, locationCoefficient);
  if (!rate) return null;
  const tools = toolsFor(ctx, tier);
  const bonus = tools.reduce((sum, tool) => sum + tool.amount, 0);
  return {
    tier,
    tools,
    bonus,
    min: rate.min + bonus,
    max: rate.max + bonus,
    locationCoefficient,
  };
}

// Pure: context + the two dials -> the range this character would get. { ok: false, reason } | { ok: true, tier, min, max, expression, ... }
function resolveLaborRateFrom(ctx, coefficient, { lifewebFailing = false } = {}) {
  const access = computeLaborAccess(ctx);
  if (!access.ok) return access;

  // A refinery pays in goods, not ⬢, with no LocationYield row behind it — anybody standing here can work it. Range must be a real 0-0 so db/lib/resourceDelta.js#rollResourceRange still parses it (an empty string would silently pay nothing while looking like a bug). See docs/systemdocs/FACTORY.md.
  if (ctx.refinery) {
    if (!ctx.refineryInput) {
      return { ok: false, reason: "There's no Godflesh here to refine." };
    }
    return {
      ok: true,
      tier: "refining",
      min: 0,
      max: 0,
      bonus: 0,
      tools: [],
      halvedBy: [],
      lifewebFailing,
      locationCoefficient: 1,
      refinery: true,
      expression: "0-0",
    };
  }

  const candidates = [];
  for (const { slug, tier } of GENERAL_TIERS) {
    if (!ctx.tagSlugs.has(slug)) continue;
    candidates.push(scoreCandidate(ctx, tier, coefficient, 1));
    // Only the best general tier competes: Skilled doesn't imply holding Basic (parentTag chain replaces it), but a GM-granted pair would otherwise double-score for nothing.
    break;
  }

  for (const { slug, tier } of SPECIALISATIONS) {
    if (!ctx.tagSlugs.has(slug)) continue;
    const kind = SPECIALISATION_KINDS[tier];
    const locationCoefficient = ctx.yields?.[kind];
    // No row, or a row that has bottomed out: there is nothing to work here.
    if (!locationCoefficient || locationCoefficient <= 0) continue;
    candidates.push(scoreCandidate(ctx, tier, coefficient, locationCoefficient));
  }

  // Nothing you hold pays here: it still files as a day's work (Move stands, fatigue ladder steps) paying nothing; surfaces print an em dash rather than a range. Deliberately not a tier the drop die knows (db/lib/laborDrops.js maps six real ones) — a labor drop is something a skill earns.
  const scored = candidates.filter(Boolean);
  if (scored.length === 0) {
    return {
      ok: true,
      tier: "unskilled",
      min: 0,
      max: 0,
      bonus: 0,
      tools: [],
      halvedBy: [],
      lifewebFailing,
      locationCoefficient: 1,
      expression: "0-0",
    };
  }

  // Best by ceiling, tie-broken on floor — a specialisation beating your general tier wins automatically; one that doesn't never costs you.
  scored.sort((a, b) => b.max - a.max || b.min - a.min);
  const best = scored[0];

  let { min, max } = best;

  // Two independent halvings that compound: Soft Hands is who you are, Tireless-while-Exhausted is the state you're in. Each is named because the player-facing note must say which cost them — a bare "halved" on a merely-tired day reads as a bug.
  const halvedBy = [];
  if (ctx.tagSlugs.has(SOFT_HANDS_SLUG)) halvedBy.push("Soft Hands");
  if (ctx.tagSlugs.has(EXHAUSTED_SLUG) && ctx.tagSlugs.has(LABORING_TIRELESS_SLUG))
    halvedBy.push("working while Exhausted");
  for (let i = 0; i < halvedBy.length; i++) {
    min = Math.floor(min / 2);
    max = Math.floor(max / 2);
  }

  if (lifewebFailing) {
    // Basic is not scaled, it stops. Everything else keeps a twentieth.
    if (best.tier === "basic") {
      min = 0;
      max = 0;
    } else {
      min = Math.floor(min * LIFEWEB_FAILURE_MULTIPLIER);
      max = Math.floor(max * LIFEWEB_FAILURE_MULTIPLIER);
    }
  }

  return {
    ok: true,
    tier: best.tier,
    min,
    max,
    bonus: best.bonus,
    tools: best.tools,
    halvedBy,
    lifewebFailing,
    locationCoefficient: best.locationCoefficient,
    // MACHINE format, parsed back by db/lib/resourceDelta.js#rollResourceRange (`/^(\d+)-(\d+)$/`) when paid. Anything appended ("(+3 Longbow)") fails that regex and pays nothing — say the bonus in the DM instead, never here.
    expression: `${min}-${max}`,
  };
}

// Prose for the tier that won, so a DM can say what happened rather than just quoting a number.
const TIER_LABELS = {
  basic: "Laboring",
  skilled: "Laboring",
  hunting: "Hunting",
  farming: "Farming",
  fishing: "Fishing",
  prospecting: "Prospecting",
  refining: "Refining",
};

function laborTierLabel(tier) {
  return TIER_LABELS[tier] ?? "Laboring";
}

// Shared wording for "why your roll is this size" so the Move-confirm DM (bot/) and auto-labor DM (db/) can't drift apart. Discord `-#` subtext (db/lib/ambientLine.js) explains a number rather than competing with it; the web Move dialog prints it bare, so no prefix is baked in here. See docs/systemdocs/FACTORY.md.
const REFINERY_NOTE = `One Godflesh in, ${REFINERY_YIELD} cubes out.`;
const REFINERY_EMPTY_NOTE = "There was no Godflesh left on the floor when you started working.";

// Returns null when there is nothing to explain, so a caller can spread it straight into a lines array.
function formatLaborBonusNote(
  { tools = [], halvedBy = [], lifewebFailing = false, refinery = false } = {},
  { refined = true } = {},
) {
  // A refining shift has no tools/dials — what it made is the whole story (describeMoveEffects already said it). Second branch matters: sharing one lump among refugees is the normal case when the stash runs thin, and the losers need to know why their day came to nothing.
  if (refinery) {
    return refined ? `-# ${REFINERY_NOTE}` : `-# ${REFINERY_EMPTY_NOTE}`;
  }
  const parts = [];
  for (const tool of tools) {
    if (tool.amount) parts.push(`+${tool.amount} ⬢ from ${tool.name}`);
  }
  // Each cut named — a bare "halved" on a merely-tired day read as a bug, and two possible cuts must say which applied.
  if (halvedBy.length > 0) parts.push(`halved by ${halvedBy.join(" and then by ")}`);
  if (lifewebFailing) parts.push("and the Lifeweb is failing, so almost nothing came of it");
  if (parts.length === 0) return null;
  const [first, ...rest] = parts;
  const sentence = `${first.charAt(0).toUpperCase()}${first.slice(1)}${rest.length ? `, ${rest.join(", ")}` : ""}`;
  return `-# Includes ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}.`;
}

// Async convenience for one-character call sites (Move modal, Labor? button) with no context loaded yet.
async function resolveLaborRate(prisma, characterId) {
  const [ctx, config, state] = await Promise.all([
    buildLaborContext(prisma, characterId),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { productionCoefficient: true },
    }),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { lifewebBlood: true } }),
  ]);
  return resolveLaborRateFrom(ctx, config?.productionCoefficient ?? 1, {
    lifewebFailing: (state?.lifewebBlood ?? 100) <= LIFEWEB_SPUTTER_THRESHOLD,
  });
}

module.exports = {
  LIFEWEB_FAILURE_MULTIPLIER,
  REFINERY_NOTE,
  REFINERY_EMPTY_NOTE,
  lazyYield,
  lazyExpression,
  buildLaborContext,
  canLaborAtAll,
  computeLaborAccess,
  formatLaborBonusNote,
  laborTierLabel,
  resolveLaborRateFrom,
  resolveLaborRate,
  structureTools,
  toolsFrom,
  yieldMap,
};
