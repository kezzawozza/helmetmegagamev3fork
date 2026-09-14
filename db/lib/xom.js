// Old Ways (Xom), the fifth Old Way and the only one nobody can buy.
//
// A character picks it up by pressing Pray in the Shrine of an Old Man
// (docs/zones.yaml, under depths-chasm) and by no other route. From then on,
// every turn close rolls once on the table below — db/lib/xomPass.js does the
// rolling, this file only holds the table and the two things both faces need.
//
// WHY THE TABLE IS HERE AND NOT IN YAML. docs/labordrops.yaml is a YAML master
// because every row in it means the same thing ("grant this slug"), so a GM can
// re-tune the pool without a deploy. Six of the thirteen rows here are distinct
// CODE PATHS — a gib, a teleport, a conversation, a shout, a mass grant across
// two factions — so a YAML row would need a `kind:` discriminator that maps
// one-to-one onto a switch the code already contains. That is a second place to
// keep in step, plus a sync script and a Prisma model, in exchange for no
// editability at all. The labor-drop file also weights by REPEATING an entry,
// which cannot express the half-unit the mass-madness row carries.
//
// KEEP THIS FILE LEAF-LIGHT. db/lib/placeAffordances.js requires it for the
// shrine slug, and that module is loaded by the zone sync — so nothing heavier
// than ./tagWrites belongs here. The pass is where characterDeath, roleGroups
// and shout get pulled in.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { addToStack, dropCharacterTag } = require("./tagWrites");

const OLD_WAYS_XOM_SLUG = "old-ways-xom";

// Hardcoded for the db/lib/roleIds.js reason the bell's room slug gives: one
// guild, one correct value, and a missing env var would have been a silent
// no-op. It must match the room id in docs/zones.yaml exactly.
const XOM_SHRINE_ROOM_SLUG = "chasm-shrine-of-an-old-man";

// The Beliefs group. Every tag in it carries `exclusive: true`, which the buy
// paths enforce and a grant does not — so Pray has to do the enforcing itself.
// See grantXom below.
const BELIEF_GROUP_SLUG = "general-beliefs";

// The one Belief Xom will not take off somebody, because taking it would do a
// great deal more than change what they believe: {tag:thanati} is the cult's
// membership card, and dropping it would quietly pull a cultist out of their
// objectives, their rites and their hideout with nothing said to anybody.
// Somebody already spoken for is refused instead — the cult got there first.
// A GM who really means it strips the tag by hand, the way every other
// absolute block in the catalog works.
const THANATI_SLUG = "thanati";

// Slugs the table hands out. Named here so db/test/xom.test.js can assert the
// pass and the table agree, and so a typo is a test failure rather than a turn
// close that quietly grants nothing.
const FECES_SLUG = "feces";
const CAVE_RAT_SLUG = "skinned-cave-rat";
const RAVENHEART_RED_SLUG = "ravenheart-red";
const GRENADE_SLUG = "fragmentation-grenade";
const SEIZURE_SLUG = "seizure";
const MADNESS_SLUG = "madness";
const MELEE_LEGENDARY_SLUG = "melee-legendary";
const RAGE_SLUG = "rage";

// THE TABLE. Bascinet's numbers, verbatim and unnormalised — they are weights,
// not percentages, and they do not sum to 100 on purpose. Normalisation happens
// once, at roll time, in pickXomOutcome; nobody should ever rewrite these into
// percentages, because then a later edit has to re-balance twelve other rows to
// change one.
const XOM_OUTCOMES = Object.freeze([
  Object.freeze({ id: "nothing", weight: 50 }),
  // Teleport to a random other living character, then open a conversation
  // between the two of them. Does not fire if there is nobody else.
  Object.freeze({ id: "lonely", weight: 10 }),
  Object.freeze({ id: "feces", weight: 10 }),
  Object.freeze({ id: "shout", weight: 20 }),
  Object.freeze({ id: "rats", weight: 5 }),
  Object.freeze({ id: "gib", weight: 1 }),
  Object.freeze({ id: "seizure", weight: 1 }),
  Object.freeze({ id: "red", weight: 1 }),
  Object.freeze({ id: "melee", weight: 1 }),
  Object.freeze({ id: "grenade", weight: 1 }),
  Object.freeze({ id: "rage", weight: 1 }),
  // Every clergy character at once. Half a unit, which is the whole reason the
  // table carries explicit numbers instead of repeating entries.
  Object.freeze({ id: "madness", weight: 0.5 }),
]);

const XOM_TOTAL_WEIGHT = XOM_OUTCOMES.reduce((sum, row) => sum + row.weight, 0);

// The seven things a Xom-holder shouts. Bascinet's words — no on any of them.
const XOM_SHOUTS = Object.freeze([
  "HAHAHAHAHAHAH!",
  "PLEASE HELP ME! OH GOD, HELP! HELP ME!",
  "HELP ME!",
  "My nerves are on the inside!",
  "I hit my funny bone…",
  "Hahahah! Haaaaha!",
  "I'm going to kill you, motherfucker!",
]);

// Bascinet's words, all three. No.
const XOM_LONELY_LINE = "You are too alone!! You two!! Talk to each other!!";
const XOM_FECES_LINE = "You couldn't control yourself…";
const XOM_MADNESS_LINE = "Oh god, what is happening! You're going insane—kill everyone!";

// A cumulative walk, taking `rng` the way db/lib/dawnAfflictionPass.js and
// db/lib/nameCorpus.js do, so a test can force any row. Pure on purpose.
function pickXomOutcome(rng = Math.random) {
  let roll = rng() * XOM_TOTAL_WEIGHT;
  for (const row of XOM_OUTCOMES) {
    roll -= row.weight;
    // `< 0` rather than `<= 0`, so a roll landing exactly on a boundary belongs
    // to the row AFTER it — which is what makes the arithmetic in the test
    // readable and keeps a zero-weight row (if anyone ever adds one)
    // unreachable rather than reachable at exactly one value.
    if (roll < 0) return row.id;
  }
  // Floating-point can leave the last subtraction at exactly 0. The table's
  // final row is the answer, never a throw — a turn close must not die here.
  return XOM_OUTCOMES[XOM_OUTCOMES.length - 1].id;
}

function pickShout(rng = Math.random) {
  return XOM_SHOUTS[Math.floor(rng() * XOM_SHOUTS.length)] ?? XOM_SHOUTS[0];
}

// What Pray does, shared by the bot handler and the web server action so the
// two faces can never drift. Returns { ok, already, spoken, replaced } —
// `replaced` names the Belief or Beliefs it took off them, for the
// confirmation line, and `spoken` is the Thanati refusal above.
//
// THE REPLACE IS DELIBERATE. Tag.exclusive is enforced only by
// exclusiveConflict() in the buy paths (PointBuy, createCharacter, the store,
// the Add Tag request), so nothing here would stop Xom stacking on top of
// Eusoch — and a sheet carrying two mutually exclusive Beliefs is a state no
// other code path in the game can produce. Of refuse / stack / replace,
// replace is also the only one that reads right in fiction: a god of disorder
// takes your old faith off you. The confirm copy on both faces says so.
async function grantXom(prisma, { characterId, turnNumber = null } = {}) {
  void turnNumber; // permanent — the tag carries no durationTurns
  const tag = await prisma.tag.findUnique({
    where: { slug: OLD_WAYS_XOM_SLUG },
    select: { id: true },
  });
  if (!tag) {
    console.error(`grantXom: no "${OLD_WAYS_XOM_SLUG}" tag — run npm run db:sync-tags.`);
    return { ok: false, already: false, replaced: null };
  }

  return prisma.$transaction(async (tx) => {
    const held = await tx.characterTag.findMany({
      where: { characterId, tag: { group: { slug: BELIEF_GROUP_SLUG }, exclusive: true } },
      select: { tagId: true, tag: { select: { slug: true, name: true } } },
    });
    if (held.some((row) => row.tag.slug === OLD_WAYS_XOM_SLUG)) {
      return { ok: false, already: true, replaced: null };
    }
    if (held.some((row) => row.tag.slug === THANATI_SLUG)) {
      return { ok: false, already: false, spoken: true, replaced: null };
    }

    // Every one of them, not just the first: Fundamentalist stacks on
    // Post-Christian through requiredTag, so two exclusive Beliefs on one
    // sheet is a legitimate state and both have to come off.
    const replaced = [];
    for (const row of held) {
      await dropCharacterTag(tx, characterId, row.tagId);
      replaced.push(row.tag.name);
    }
    await addToStack(tx, characterId, tag.id, 1, { source: "EVENT" });
    return { ok: true, already: false, replaced: replaced.join(" and ") || null };
  });
}

module.exports = {
  OLD_WAYS_XOM_SLUG,
  XOM_SHRINE_ROOM_SLUG,
  FECES_SLUG,
  CAVE_RAT_SLUG,
  RAVENHEART_RED_SLUG,
  GRENADE_SLUG,
  SEIZURE_SLUG,
  MADNESS_SLUG,
  MELEE_LEGENDARY_SLUG,
  RAGE_SLUG,
  XOM_OUTCOMES,
  XOM_TOTAL_WEIGHT,
  XOM_SHOUTS,
  XOM_LONELY_LINE,
  XOM_FECES_LINE,
  XOM_MADNESS_LINE,
  pickXomOutcome,
  pickShout,
  grantXom,
};
