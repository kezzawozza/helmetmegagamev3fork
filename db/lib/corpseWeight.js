// What a body weighs (CORPSES.md, CARRY.md §2). Two parts: the BODY (base weight bent by build), and
// their GEAR — because "a corpse is a handle to a dead character's sheet, not a container" (CORPSES.md
// §1), so belongings never move off the Character row and whoever hauls the body hauls the armour too.
// STORED on the corpse Tag's `weightLbs`, not computed at read time — db/lib/carry.js#rowWeight reads
// that one column. A derived value kept fresh: minted with the corpse, recomputed whenever looted.
const { CORPSE_GROUP_SLUG } = require("./constants");
const { rowWeight } = require("./carry");

// A human body. Deliberately under the 71 lb base cap (GameConfig.carryWeightLbs) rather than near it.
const BASE_CORPSE_LBS = 50;

// The build, as multipliers rather than flat adds, so they compose sanely — a frail dwarf lands at 28
// lb, not zero. `strong` is deliberately NOT here — the difference is small and not worth taxing.
const BUILD_MULTIPLIERS = [
  ["giant", 1.5],   // a behemoth among humanity — lands on the Graga's 75
  ["fat", 1.3],
  ["frail", 0.8],   // physically weak and fragile: less of them to carry
  ["dwarf", 0.7],   // very short
];

// Never lighter than this however the traits stack.
const MIN_BODY_LBS = 20;

// The body alone. Pure — no prisma. Accepts CharacterTag[] (with .tag) or a bare list of slugs.
function corpseBodyWeight(tags = []) {
  const slugs = new Set(
    (tags ?? [])
      .map((entry) => (typeof entry === "string" ? entry : (entry?.tag?.slug ?? entry?.slug)))
      .filter(Boolean),
  );
  let lbs = BASE_CORPSE_LBS;
  for (const [slug, multiplier] of BUILD_MULTIPLIERS) {
    if (slugs.has(slug)) lbs *= multiplier;
  }
  return Math.max(MIN_BODY_LBS, Math.round(lbs));
}

// What the dead character is still carrying. The corpse tag itself is excluded — a corpse can be
// dropped onto its own character's sheet (CORPSES.md §1), so counting blindly would double-count it.
// Untradeable rows and Assets are skipped, same as carry.js.
function gearWeight(characterTags = []) {
  let lbs = 0;
  for (const ct of characterTags ?? []) {
    const tag = ct?.tag;
    if (!tag) continue;
    if (tag.corpseOfCharacterId) continue;
    if (tag.group?.slug === CORPSE_GROUP_SLUG) continue;
    lbs += rowWeight(ct);
  }
  return Math.round(lbs * 10) / 10;
}

// Everything carry.js needs to answer both halves.
const WEIGHT_SELECT = {
  tags: {
    select: {
      quantity: true,
      tag: {
        select: {
          slug: true,
          weightLbs: true,
          tradeable: true,
          category: true,
          corpseOfCharacterId: true,
          group: { select: { slug: true } },
        },
      },
    },
  },
};

// Body plus gear. Returns null when there is nothing to weigh, so a caller can leave the column alone.
async function corpseWeightFor(prisma, characterId) {
  if (!characterId) return null;
  const row = await prisma.character
    .findUnique({ where: { id: characterId }, select: WEIGHT_SELECT })
    .catch(() => null);
  if (!row) return null;
  return corpseBodyWeight(row.tags) + gearWeight(row.tags);
}

// Write it back onto the body — called on mint and again whenever the sheet changes hands. Best-effort
// and silent on a miss: a corpse a few pounds stale is not worth failing a loot over.
async function refreshCorpseWeight(prisma, characterId) {
  if (!characterId) return null;
  try {
    const corpse = await prisma.tag.findFirst({
      where: { corpseOfCharacterId: characterId },
      select: { id: true },
    });
    if (!corpse) return null;
    const weightLbs = await corpseWeightFor(prisma, characterId);
    if (weightLbs == null) return null;
    await prisma.tag.update({ where: { id: corpse.id }, data: { weightLbs } });
    return weightLbs;
  } catch (err) {
    console.error(`Corpse weight refresh failed for ${characterId}:`, err.message ?? err);
    return null;
  }
}

module.exports = {
  corpseBodyWeight,
  gearWeight,
  corpseWeightFor,
  refreshCorpseWeight,
  BASE_CORPSE_LBS,
  MIN_BODY_LBS,
};
