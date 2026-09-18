// What a day underground is worth: the gate, the location cut, and the tools.
// Single source for the Mine button (web/app/(app)/character/actions/mine.js)
// and the Examine readout. See docs/systemdocs/MINING.md.
const { INCAPACITATING_SLUGS } = require("./incapacitation");
const { LIFEWEB_SPUTTER_THRESHOLD } = require("./lifeweb");
const { structuresAt } = require("./structures");
const { EXHAUSTED_SLUG, PROSPECTING_SLUG, LAZY_SLUG } = require("./constants");

// What a day in the seam pays at a location coefficient of 1.0, before tools
// and before either dial. Doubled from 2-8 on 2026-09-18: Prospecting stopped
// being the gate on the button and became the thing that makes the day worth
// having, so the skill had to actually pay (docs/systemdocs/MINING.md).
const MINING_RATE = { min: 4, max: 16 };

// ...and what the same day pays somebody who does not have the skill. ANYBODY
// can press Mine where there is a seam — you do not need to be told which way
// up a pick goes to shift rock — you just do it badly, and you turn up nothing
// but rock: the prospecting loot roll (db/lib/moveEffects.js) is skipped
// outright for an unskilled digger, not merely made unlikely.
//
// It is a BASE, not a flat payout: everything below the switch — the location
// coefficient, tools, Soft Hands, Lazy, the Lifeweb — applies to both rates
// alike. A flat 0-6 would have made unskilled digging in the Black Hills
// out-earn skilled digging there, which is the wrong way round.
const UNSKILLED_MINING_RATE = { min: 0, max: 6 };

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

// Soft Hands halves what you make, rounded down, AFTER tools.
const SOFT_HANDS_SLUG = "soft-hands";

// Tag group every weapon lives in. Weapon bonuses do NOT stack — only the best-paying weapon counts; everything else still sums. Nothing mining carries one today, but the rule is cheap and a pick is one edit away from being a weapon.
const WEAPON_GROUP = "items-weapons";

// What Lifeweb failure does to a day's work: below the sputter threshold a day underground keeps a twentieth.
const LIFEWEB_FAILURE_MULTIPLIER = 0.05;

// Loads everything the rules need for one character: tags held, location, its mining coefficient, and structures built there.
async function buildMiningContext(prisma, characterId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      locationId: true,
      location: {
        select: { name: true, attributes: true, mining: { select: { current: true } } },
      },
    },
  });
  const [tags, structures] = await Promise.all([
    prisma.characterTag.findMany({
      where: { characterId },
      select: {
        equipped: true,
        tag: { select: { slug: true, name: true, group: true, miningBonus: true } },
      },
    }),
    // COMPLETE only — same reading as equipmentReach.js: a half-built or damaged headframe lifts nothing, which is what gives Damage teeth.
    structuresAt(prisma, character?.locationId, { statuses: ["COMPLETE"] }),
  ]);

  return {
    locationName: character?.location?.name ?? null,
    coefficient: character?.location?.mining?.current ?? null,
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
    tools: [...toolsFrom(tags), ...structureTools(structures)],
  };
}

// Pulls miningBonus entries off a character's tags. Kept flat rather than summed, so the note can name each tool that paid.
function toolsFrom(tagRows) {
  const tools = [];
  for (const row of tagRows) {
    const bonus = row.tag?.miningBonus;
    if (!bonus || !bonus.amount) continue;
    tools.push({
      name: row.tag.name ?? row.tag.slug,
      amount: Number(bonus.amount) || 0,
      // Default true: nearly every tool is carried; one that isn't says so explicitly.
      needsEquipped: bonus.equipped !== false,
      requiresTag: bonus.requiresTag ?? null,
      equipped: row.equipped === true,
      isWeapon: row.tag?.group === WEAPON_GROUP,
    });
  }
  return tools;
}

// Structures pay everyone standing at their Location, as synthetic tools beside toolsFrom's — never equipped, never a weapon, and named through the same formatMiningBonusNote path. NON-STACKING: the best one only, so a location-wide bonus can't multiply by occupancy; ties keep the older structure since structuresAt orders by (createdAt, id). `structures` is structuresAt output (rows carrying .placement), already filtered to COMPLETE by the caller.
function structureTools(structures) {
  let best = null;
  for (const s of structures ?? []) {
    const bonus = s.placement?.miningBonus;
    if (!bonus || !bonus.amount) continue;
    const amount = Number(bonus.amount) || 0;
    if (best && best.amount >= amount) continue;
    best = {
      name: s.type?.name ?? s.typeName,
      amount,
      needsEquipped: false,
      requiresTag: null,
      equipped: false,
      isWeapon: false,
    };
  }
  return best ? [best] : [];
}

// { ok: true } or { ok: false, reason }. Only Exhausted refuses — Tired doesn't (db/lib/fatigue.js); the payout steps a character up that ladder (db/lib/moveEffects.js), and this reads Exhausted back until the expiry sweep degrades it to Tired.
function computeMiningAccess(ctx) {
  if (ctx.tagSlugs.has(EXHAUSTED_SLUG)) {
    return { ok: false, reason: "You're **Exhausted**. Rest before you can work again." };
  }
  // Tied up, bleeding out, on the floor, or out cold.
  const blocked = [...ctx.tagSlugs].find((slug) => INCAPACITATING_SLUGS.has(slug));
  if (blocked) {
    return { ok: false, reason: "You can't work" };
  }
  return { ok: true };
}

// Every tool paying in, honouring `equipped`/`requiresTag`. Non-weapons sum; weapons don't — only the best-paying weapon counts. Ties keep the first, stable because tag rows come back in a fixed order.
function toolsFor(ctx) {
  const eligible = (ctx.tools ?? []).filter((tool) => {
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

// No min>max guard: Math.round is monotonic and no multiplier is ever negative, so min <= max survives by construction; a small coefficient collapsing the base to 0-0 is correct, not a bug. `coefficient` is the global GameConfig dial; `locationCoefficient` is LocationMining.current. They multiply. `base` picks which of the two rates above is being scaled.
function computeRate(coefficient, locationCoefficient = 1, base = MINING_RATE) {
  const c = (coefficient ?? 1) * (locationCoefficient ?? 1);
  return { min: Math.round(base.min * c), max: Math.round(base.max * c) };
}

// Display form — "3" when fixed, "0–4" (en dash) when it varies. The one place that dash is written.
function formatRate(rate) {
  if (!rate) return null;
  return rate.min === rate.max ? String(rate.min) : `${rate.min}–${rate.max}`;
}

// Pure: context + the two dials -> the range this character would get.
// { ok: false, reason } | { ok: true, min, max, expression, ... }
function resolveMiningRateFrom(ctx, coefficient, { lifewebFailing = false } = {}) {
  const access = computeMiningAccess(ctx);
  if (!access.ok) return access;

  // The row IS the gate, which is why no Location carries a "minable" flag.
  // No row, or a row that has bottomed out, and there is nothing here to
  // work.
  if (!ctx.coefficient || ctx.coefficient <= 0) {
    return { ok: false, reason: "There's nothing to mine here." };
  }

  // NOT a refusal any more (2026-09-18). Prospecting is a rate switch and the
  // loot gate, not the gate on the button — see UNSKILLED_MINING_RATE above.
  // Callers read `prospecting` back off this object to decide whether to roll
  // the loot table at all; nothing else should re-derive it from the tag.
  const prospecting = ctx.tagSlugs.has(PROSPECTING_SLUG);

  const tools = toolsFor(ctx);
  const bonus = tools.reduce((sum, tool) => sum + tool.amount, 0);
  const rate = computeRate(coefficient, ctx.coefficient, prospecting ? MINING_RATE : UNSKILLED_MINING_RATE);
  let min = rate.min + bonus;
  let max = rate.max + bonus;

  // Named because the player-facing note must say what cost them — a bare "halved" reads as a bug.
  const halvedBy = [];
  if (ctx.tagSlugs.has(SOFT_HANDS_SLUG)) halvedBy.push("Soft Hands");
  for (let i = 0; i < halvedBy.length; i++) {
    min = Math.floor(min / 2);
    max = Math.floor(max / 2);
  }

  if (lifewebFailing) {
    min = Math.floor(min * LIFEWEB_FAILURE_MULTIPLIER);
    max = Math.floor(max * LIFEWEB_FAILURE_MULTIPLIER);
  }

  return {
    ok: true,
    prospecting,
    min,
    max,
    bonus,
    tools,
    halvedBy,
    lifewebFailing,
    locationCoefficient: ctx.coefficient,
    // MACHINE format, parsed back by db/lib/resourceDelta.js#rollResourceRange (`/^(\d+)-(\d+)$/`) when paid. Anything appended ("(+3 Pick)") fails that regex and pays nothing — say the bonus in the note instead, never here.
    expression: `${min}-${max}`,
  };
}

// Shared wording for "why your roll is this size", so every surface says it the same way. Discord `-#` subtext (db/lib/ambientLine.js) explains a number rather than competing with it; the web prints it bare, so no prefix is baked in here. Returns null when there is nothing to explain, so a caller can spread it straight into a lines array.
function formatMiningBonusNote({ tools = [], halvedBy = [], lifewebFailing = false } = {}) {
  const parts = [];
  for (const tool of tools) {
    if (tool.amount) parts.push(`+${tool.amount} ⬢ from ${tool.name}`);
  }
  if (halvedBy.length > 0) parts.push(`halved by ${halvedBy.join(" and then by ")}`);
  if (lifewebFailing) parts.push("and the Lifeweb is failing, so almost nothing came of it");
  if (parts.length === 0) return null;
  const [first, ...rest] = parts;
  const sentence = `${first.charAt(0).toUpperCase()}${first.slice(1)}${rest.length ? `, ${rest.join(", ")}` : ""}`;
  return `Includes ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}.`;
}

// Async convenience for one-character call sites with no context loaded yet.
async function resolveMiningRate(prisma, characterId) {
  const [ctx, config, state] = await Promise.all([
    buildMiningContext(prisma, characterId),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { productionCoefficient: true },
    }),
    prisma.gameState.findUnique({ where: { id: 1 }, select: { lifewebBlood: true } }),
  ]);
  return resolveMiningRateFrom(ctx, config?.productionCoefficient ?? 1, {
    lifewebFailing: (state?.lifewebBlood ?? 100) <= LIFEWEB_SPUTTER_THRESHOLD,
  });
}

module.exports = {
  MINING_RATE,
  UNSKILLED_MINING_RATE,
  LIFEWEB_FAILURE_MULTIPLIER,
  SOFT_HANDS_SLUG,
  lazyYield,
  lazyExpression,
  buildMiningContext,
  computeMiningAccess,
  computeRate,
  formatRate,
  formatMiningBonusNote,
  resolveMiningRateFrom,
  resolveMiningRate,
  structureTools,
  toolsFrom,
  toolsFor,
};
