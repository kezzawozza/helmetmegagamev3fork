// What a body weighs.
//
// A corpse used to weigh nothing at all, which meant a character could walk a
// pile of them across the map — while a Graga corpse (75 lb) or a nekker's
// (45 lb) has always been real cargo. See docs/systemdocs/CORPSES.md and
// docs/systemdocs/CARRY.md §2.
//
// Two parts, and the second one is the interesting half:
//
//   the BODY   — a base weight bent by the build the character actually had.
//   their GEAR — because "a corpse is a handle to a dead character's sheet,
//                not a container" (CORPSES.md §1). Their belongings never move
//                off the Character row, so whoever hauls the body is hauling
//                the plate armour still on it. Strip a body first and it gets
//                markedly easier to carry, which is the right lesson.
//
// The number is STORED on the corpse Tag's `weightLbs` rather than computed at
// read time. db/lib/carry.js#rowWeight reads that one column, and every
// readout on both faces — the Overburdened check, the overflow drop, the
// "44 / 71 lb" line — flows from it. Making one tag's weight dynamic would
// have meant threading the dead character's sheet through all of them,
// including client components. So it is a derived value kept fresh instead:
// minted with the corpse, and recomputed whenever the body is looted.
const { CORPSE_GROUP_SLUG } = require("./constants");
const { rowWeight } = require("./carry");

// A human body, and the anchor for everything below. Deliberately under the
// 71 lb base cap (GameConfig.carryWeightLbs) rather than near it: carrying
// somebody should cost you most of your back and still leave you able to walk
// with your own kit. It sits between the spindly nekker at 35 and the pink
// skinless at 55, which is about right for a person.
const BASE_CORPSE_LBS = 50;

// The build, as multipliers rather than flat adds, so they compose sanely — a
// frail dwarf is light twice over and lands at 28 lb rather than at zero.
//
// `strong` is deliberately NOT here. Muscle does weigh more than the lack of
// it, but the difference is small next to these, and quietly taxing a trait
// somebody spent points on is a poor way to spend that realism.
const BUILD_MULTIPLIERS = [
  ["giant", 1.5],   // a behemoth among humanity — lands on the Graga's 75
  ["fat", 1.3],
  ["frail", 0.8],   // physically weak and fragile: less of them to carry
  ["dwarf", 0.7],   // very short
];

// Never lighter than this however the traits stack, so a body is always
// something you notice picking up.
const MIN_BODY_LBS = 20;

// The body alone, from the tags the character held in life. Pure — no prisma —
// so a caller that already has the sheet can ask without a query.
//
// Accepts CharacterTag[] (with .tag) or a bare list of slugs, because the two
// call sites hold different shapes and neither should have to reshape first.
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

// What the dead character is still carrying, which travels with the body.
//
// The corpse tag itself is excluded, and that is not tidiness: a body whose
// Location had no public room is dropped onto its own character's sheet
// (CORPSES.md §1), so counting the sheet blindly would have a corpse weighing
// partly itself, and every recompute would add its own weight again.
//
// Untradeable rows are skipped for the same reason carry.js skips them — a
// graft in the neck is part of the person, not cargo — and Assets are exempt
// there too, so a horse standing nearby never lands on the pallbearer.
function gearWeight(characterTags = []) {
  let lbs = 0;
  for (const ct of characterTags ?? []) {
    const tag = ct?.tag;
    if (!tag) continue;
    if (tag.corpseOfCharacterId) continue;
    if (tag.group?.slug === CORPSE_GROUP_SLUG) continue;
    // rowWeight, not a second spelling of it: untradeable rows and the whole
    // Assets category are already exempt there, and two copies of that rule
    // would disagree the first time one of them changed.
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

// Body plus gear, for one dead character. Returns null when there is nothing
// to weigh, so a caller can leave the column alone rather than write a zero.
async function corpseWeightFor(prisma, characterId) {
  if (!characterId) return null;
  const row = await prisma.character
    .findUnique({ where: { id: characterId }, select: WEIGHT_SELECT })
    .catch(() => null);
  if (!row) return null;
  return corpseBodyWeight(row.tags) + gearWeight(row.tags);
}

// Write it back onto the body. Called when the corpse is minted and again
// whenever the sheet it is a handle to changes hands — looting a body lightens
// it, which is the whole reason this is not a constant.
//
// Best-effort and silent on a miss: a corpse whose weight is a few pounds
// stale is not worth failing a loot over.
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
