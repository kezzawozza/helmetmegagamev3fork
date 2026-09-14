// How good someone is in a fight. Sibling of db/lib/armorValue.js: owns the word a score shows as and how contributions combine; armour never enters this arithmetic. Pure and Prisma-free. See docs/systemdocs/COMBAT.md.

// ─── The scale ──────────────────────────────────────────────────────────────
// Everything tunable is here; rebalance by editing this block, not docs/tags.yaml. A tier is 10 points so a tag can be authored at half a tier without floats — docs/tags.yaml speaks tiers, tagShapes.js multiplies by this on the way in.
const { SECOND_WIND_SLUG, WOUND_TAG_GROUPS } = require("./constants");
const { HEALTH_CATEGORY } = require("./medicalVision");

const SECOND_WIND_LABEL = "Second Wind";

const POINTS_PER_TIER = 10;

// Baseline for no skill at all. 15, not 16, so every RUNG lands dead centre of its band (25,35,45,55,65) — mid-band keeps the words stable, so a small trait doesn't relabel someone. Weak itself runs 5-19, not 10-19 (see BANDS), deliberately off-centre: the widened room is under the base, for injuries.
const UNTRAINED = 15;

// One rung of melee-*/ranged-* == one tier, so "counts as 2 tiers higher" in a tag description stays literally true.
const RUNG_STEP = POINTS_PER_TIER;

// Eight bands, ten points each except Pitiful (deliberate: bands measure SKILL, not injury, so the bottom band should take a real injury to reach — Weak widens to 5-19 instead). `key` drives stylesheet colour (.fighting-band[data-band]); always show the word, never the number, same posture as Tag.meleeArmor and laborYield.js#qualityWord.
const BANDS = Object.freeze([
  { max: 4, key: "pitiful", label: "Pitiful" },
  { max: 19, key: "weak", label: "Weak" },
  { max: 29, key: "mediocre", label: "Mediocre" },
  { max: 39, key: "capable", label: "Capable" },
  { max: 49, key: "seasoned", label: "Seasoned" },
  { max: 59, key: "dangerous", label: "Dangerous" },
  { max: 69, key: "lethal", label: "Lethal" },
  // Real number, not Infinity: band objects cross the server/client boundary and JSON turns Infinity into null, which put everybody in this band.
  { max: Number.MAX_SAFE_INTEGER, key: "legendary", label: "Legendary" },
]);

// Nobody goes below the bottom band — no colder word to reach, so no reason to track how far past it someone is.
const SCORE_FLOOR = 0;

// The two halves of the tree (docs/tags.yaml:2495: never overlap). `both` means a tag lands on each separately, never that they merge.
const TREES = Object.freeze(["melee", "ranged"]);

// Drawn vs swung. A weapon's class is the only thing saying which half of the tree it serves — this stops a longbow paying into a melee band.
const RANGED_CLASSES = Object.freeze(new Set(["bow", "crossbow", "firearm", "thrown"]));

const WEAPON_CLASSES = Object.freeze(
  new Set(["sword", "polearm", "club", "axe", "knife", "unarmed", "bow", "crossbow", "firearm", "thrown", "exotic"]),
);

// ─── Words ──────────────────────────────────────────────────────────────────

function bandOfScore(score) {
  const n = typeof score === "number" && Number.isFinite(score) ? score : UNTRAINED;
  return BANDS.find((b) => n <= b.max);
}

// Ladder position (0 Pitiful..7 Legendary) — the unit a GAP is measured in, and why attack.js reads bands not scores: floor:/cap: tags (Apex Form, Bound, Paralyzed) move the index after points are summed, so a tied-up Expert still scores 55 but the band says Pitiful.
function bandRank(key) {
  return BANDS.findIndex((b) => b.key === key);
}

// The one place a score becomes a word.
function fightingWord(score) {
  return bandOfScore(score).label;
}

// ─── Reading a held row ─────────────────────────────────────────────────────

// Accepts the CharacterTag shape (`{ tag: {...} }`) or a bare Tag[], same latitude as gambitModifier.js#holds.
function tagOf(entry) {
  return entry?.tag ?? entry ?? null;
}

function blockOf(entry) {
  const block = tagOf(entry)?.fighting;
  return block && typeof block === "object" ? block : null;
}

function slugOf(entry) {
  return tagOf(entry)?.slug ?? null;
}

function nameOf(entry) {
  return tagOf(entry)?.name ?? slugOf(entry) ?? "Something";
}

// Equipped means equipped (armorValue.js: "a vest in your cart stops nothing") — a sword in a sack is the whole difference armed/unarmed. `!== false` so a bare Tag[] with no flag still reads as equipped.
function isEquipped(entry) {
  return entry?.equipped !== false;
}

// Does this tag's block speak to the tree being resolved? `both` and a missing tree (a bare weapon, whose class decides) both answer yes.
function servesTree(block, tree) {
  if (!block?.tree) return true;
  return block.tree === tree || block.tree === "both";
}

// ─── Conditions ─────────────────────────────────────────────────────────────

// Every key present must hold — an AND, so a bonus needing several conditions at once (Thanati robes: Belief AND robes worn) is one entry.
function whenHolds(when, ctx) {
  if (!when) return true;
  if (when.holds?.length && !when.holds.every((s) => ctx.held.has(s))) return false;
  // OR, unlike `holds` above — see FIGHTING_WHEN_KEYS in db/lib/tagShapes.js.
  if (when.holdsAny?.length && !when.holdsAny.some((s) => ctx.held.has(s))) return false;
  if (when.equipped?.length && !when.equipped.every((s) => ctx.equipped.has(s))) return false;
  if (when.unarmoured?.length && when.unarmoured.some((slot) => ctx.armouredSlots.has(slot))) return false;
  // weaponClass deliberately NOT tested here — resolved per-weapon in bestArmed() below, so "+2 while using swords" attributes to the sword in use, not the character generally (else sword+mace would pay both specialisms).
  return true;
}

// ─── The parts ──────────────────────────────────────────────────────────────

// Highest rung held on this half of the tree. Rungs chain by parentTag, so a character normally holds all up to their level; max rather than sum is what makes that harmless.
function rungBase(rows, tree) {
  let best = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block || typeof block.rung !== "number") continue;
    if (!servesTree(block, tree)) continue;
    if (!best || block.rung > best.rung) best = { rung: block.rung, label: nameOf(row) };
  }
  if (!best) return { points: UNTRAINED, label: null };
  return { points: UNTRAINED + RUNG_STEP * best.rung, label: best.label };
}

// A wound (Health category AND one of three wound groups) — what Second Wind waives. A tag whose group wasn't selected reads as not-a-wound (fails safe: penalty still counts).
function isWoundRow(row) {
  const tag = tagOf(row);
  return tag?.category === HEALTH_CATEGORY && WOUND_TAG_GROUPS.includes(tag?.group?.slug);
}

// Illnesses are waived too, but only up to a threshold (not a slug list, so a future illness isn't missed): the catalog runs -0.3 to -1.5 then jumps to -2, so -15 (STORED points, not authored tiers — normalizeFighting multiplies by 10) draws the line between "fight through it" and "actively killing you" (Choking, Envenomated, an Exploded Chest).
const SECOND_WIND_ILLNESS_FLOOR = -15;

function isWaivedIllnessRow(row, points) {
  const tag = tagOf(row);
  if (tag?.category !== HEALTH_CATEGORY) return false;
  if (tag?.group?.slug !== "health-illness") return false;
  return points >= SECOND_WIND_ILLNESS_FLOOR;
}

// Everything programmatic not about a weapon. These SUM — a maiming and a hangover both land (docs/handbook.md:350: weapon + gear + skill all stack).
function modifiers(rows, tree, ctx) {
  const out = [];
  for (const row of rows) {
    const block = blockOf(row);
    if (!block || !block.points || block.weaponClass) continue;
    if (block.situational) continue;
    if (!servesTree(block, tree)) continue;
    if (block.when?.weaponClass?.length) continue;
    const slug = slugOf(row);
    // A wound the holder fights through: named at 0, not dropped, so a player can read why it costs nothing. WOUNDS ONLY, not the whole Health category — widening it would buy off Blind, Cripple, every illness/maiming at once on a creation-buyable tag. Only PENALTIES are waived (a helpful Health tag still helps); band CAPS (Dying, Paralyzed, Seizure) are untouched since those remove you from a fight rather than worsen it.
    if (
      ctx.secondWind &&
      block.points < 0 &&
      (isWoundRow(row) || isWaivedIllnessRow(row, block.points))
    ) {
      out.push({ label: nameOf(row), points: 0, cancelledBy: SECOND_WIND_LABEL });
      continue;
    }
    if (ctx.cancelled.has(slug)) {
      // Named rather than dropped, so a player wondering why a missing hand costs nothing can read the answer.
      out.push({ label: nameOf(row), points: 0, cancelledBy: ctx.cancelledBy.get(slug) ?? null });
      continue;
    }
    if (!whenHolds(block.when, ctx)) continue;
    out.push({ label: nameOf(row), points: block.points });
  }
  return out;
}

// The weapon in hand plus its keyed specialism. You swing ONE weapon, so only the best combination pays (docs/handbook.md:350: carrying two doesn't pay twice). Each candidate is scored as weapon + every skill naming its class together, since the pairing is the point.
function bestArmed(rows, tree, ctx) {
  const skills = rows.filter((row) => {
    const block = blockOf(row);
    return block?.points && block.when?.weaponClass?.length && servesTree(block, tree);
  });

  let best = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block?.weaponClass || !isEquipped(row)) continue;
    const ranged = RANGED_CLASSES.has(block.weaponClass);
    if ((tree === "ranged") !== ranged) continue;
    if (ctx.cancelled.has(slugOf(row))) continue;

    const parts = [];
    if (block.points) parts.push({ label: nameOf(row), points: block.points });
    for (const skill of skills) {
      const sb = blockOf(skill);
      if (!sb.when.weaponClass.includes(block.weaponClass)) continue;
      if (!whenHolds(sb.when, ctx)) continue;
      parts.push({ label: nameOf(skill), points: sb.points });
    }
    const total = parts.reduce((sum, p) => sum + p.points, 0);
    if (!best || total > best.total) best = { total, parts };
  }
  return best?.parts ?? [];
}

// Things no code can know (duel? rough ground? natural opponent?). NEVER summed — stops Duelist+Guerrilla+Sniper running away — shown beside the number for the adjudicator. An entry with no shift (Camouflage, Iron Constitution) belongs here too: real weight, no tier.
function situationals(rows, tree) {
  const out = [];
  for (const row of rows) {
    const block = blockOf(row);
    if (!block?.situational) continue;
    if (!servesTree(block, tree)) continue;
    // Name and shift only — which moment it's for lives in the tag's own description, not duplicated here.
    out.push({
      label: nameOf(row),
      tiers: block.points ? block.points / POINTS_PER_TIER : null,
    });
  }
  return out;
}

// A floor is not a bonus — Apex Form IS Legendary, Bound IS Pitiful, not numbers added to what someone had. Never a cap: a Legendary-rung fighter who turns keeps their band.
function floorBand(rows, tree) {
  let best = -1;
  let label = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block?.floor || !servesTree(block, tree)) continue;
    const idx = BANDS.findIndex((b) => b.key === block.floor);
    if (idx > best) {
      best = idx;
      label = nameOf(row);
    }
  }
  return best < 0 ? null : { index: best, label };
}

// A ceiling stated as a band, for tags taking someone OUT of a fight rather than worsening one. Same shape as floorBand, opposite direction; the lower of the two wins, so Bound beats Apex Form.
function capBand(rows, tree) {
  let best = BANDS.length;
  let label = null;
  for (const row of rows) {
    const block = blockOf(row);
    if (!block?.cap || !servesTree(block, tree)) continue;
    const idx = BANDS.findIndex((b) => b.key === block.cap);
    if (idx >= 0 && idx < best) {
      best = idx;
      label = nameOf(row);
    }
  }
  return best >= BANDS.length ? null : { index: best, label };
}

// ─── The answer ─────────────────────────────────────────────────────────────

function contextOf(rows) {
  const held = new Set();
  const equipped = new Set();
  const armouredSlots = new Set();
  const cancelled = new Set();
  const cancelledBy = new Map();

  for (const row of rows) {
    const tag = tagOf(row);
    if (!tag?.slug) continue;
    held.add(tag.slug);
    if (isEquipped(row)) {
      equipped.add(tag.slug);
      // "Wearing armour" for Flamboyant means something is IN the slot (a robe counts) — armour VALUES never enter this file, only occupancy.
      if (tag.equipSlot) armouredSlots.add(tag.equipSlot);
    }
    for (const slug of blockOf(row)?.cancels ?? []) {
      cancelled.add(slug);
      if (!cancelledBy.has(slug)) cancelledBy.set(slug, tag.name ?? tag.slug);
    }
  }
  // Second Wind cancels what a Health tag TAKES OFF, nothing else. Lives here rather than a catalog `cancels:` list because it cancels a category (every wound/illness/maiming, present and future), not a set of slugs.
  const secondWind = held.has(SECOND_WIND_SLUG);
  return { held, equipped, armouredSlots, cancelled, cancelledBy, secondWind };
}

// One half of the tree, resolved: score, band, named breakdown (shape from gambitModifier.js, for the sheet hover) and situational list.
function fightingSkillFor(characterTags = [], tree = "melee", ctx = null) {
  const rows = Array.isArray(characterTags) ? characterTags.filter(Boolean) : [];
  const context = ctx ?? contextOf(rows);

  const base = rungBase(rows, tree);
  const parts = [
    // The base is a standing, not a shift, so it carries no tier count ("+5.6 tiers of being an Expert" isn't a thing) — the rest of the breakdown reads in tiers.
    { label: base.label ?? "Untrained", points: base.points, base: true },
    ...modifiers(rows, tree, context),
    ...bestArmed(rows, tree, context),
  ];

  const raw = parts.reduce((sum, p) => sum + p.points, 0);
  const score = Math.max(SCORE_FLOOR, raw);

  let index = BANDS.indexOf(bandOfScore(score));
  const floor = floorBand(rows, tree);
  if (floor && floor.index > index) index = floor.index;
  const cap = capBand(rows, tree);
  if (cap && cap.index < index) index = cap.index;

  return {
    tree,
    score,
    // `max` stays internal — shipping it would invite a surface to re-derive a band instead of asking.
    band: { key: BANDS[index].key, label: BANDS[index].label },
    // Named for the hover; tiers not points, since tiers are the unit tag descriptions speak.
    contributors: parts.map((p) => (p.base ? p : { ...p, tiers: p.points / POINTS_PER_TIER })),
    floor: floor?.label ?? null,
    cap: cap?.label ?? null,
    situational: situationals(rows, tree),
  };
}

// Both halves at once — the catalog keeps them separate, so the readout reads "Seasoned · Weak" like the armour line's "Melee: Good | Ballistic: Meager".
function fightingSkill(characterTags = []) {
  const rows = Array.isArray(characterTags) ? characterTags.filter(Boolean) : [];
  const ctx = contextOf(rows);
  const out = {};
  for (const tree of TREES) out[tree] = fightingSkillFor(rows, tree, ctx);
  return out;
}

// "Seasoned · Weak" — melee first, matching the sheet and GM inspector.
function formatFightingSkill(resolved) {
  if (!resolved) return null;
  return TREES.map((t) => resolved[t]?.band?.label ?? "Weak").join(" · ");
}

// Tag columns a fighting-band resolver must select — same discipline as ARMOR_TAG_FIELDS in armorValue.js: miss one and combat silently breaks at that surface only. `equipSlot` is for Flamboyant; `category` is for Second Wind (drop it and every wound quietly costs a Second Wind holder again). `group` is deliberately excluded — every caller already spreads a wider select for it (web/lib/referenceData.js's TAG_CHIP_FIELDS) and a narrower `group` here would overwrite that and strip colour off every chip; a caller must select `group: { select: { slug: true } } }` itself, and a row with no group reads as not-a-wound (fails safe: the penalty still counts).
const FIGHTING_TAG_FIELDS = { fighting: true, equipSlot: true, category: true };

module.exports = {
  BANDS,
  POINTS_PER_TIER,
  TREES,
  UNTRAINED,
  WEAPON_CLASSES,
  FIGHTING_TAG_FIELDS,
  bandRank,
  fightingSkill,
  fightingSkillFor,
  fightingWord,
  formatFightingSkill,
};
