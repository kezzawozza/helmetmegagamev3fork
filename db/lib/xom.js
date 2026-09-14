// Old Ways (Xom), the fifth Old Way and the only one nobody can buy. Picked up
// by pressing Pray in the Shrine of an Old Man (docs/zones.yaml,
// depths-chasm), and no other route. Every turn close rolls once on the table
// below — db/lib/xomPass.js does the rolling, this file holds the table.
// WHY THE TABLE IS HERE AND NOT IN YAML: six of the thirteen rows are
// distinct CODE PATHS (gib, teleport, conversation, shout, a mass grant), so
// a YAML row would need a `kind:` discriminator mapping onto the switch that
// already exists, plus a sync script and Prisma model, for no editability.
// KEEP THIS FILE LEAF-LIGHT: db/lib/placeAffordances.js requires it for the
// shrine slug and is loaded by the zone sync, so nothing heavier than
// ./tagWrites belongs here. Takes `prisma` as a parameter and stays off the
// @lifeweb/db barrel, the db/lib/dm.js convention; require it by path.
const { addToStack, dropCharacterTag } = require("./tagWrites");

const OLD_WAYS_XOM_SLUG = "old-ways-xom";

// Hardcoded for the db/lib/roleIds.js reason: one guild, one correct value.
// Must match the room id in docs/zones.yaml exactly.
const XOM_SHRINE_ROOM_SLUG = "chasm-shrine-of-an-old-man";

// The Beliefs group. Every tag carries `exclusive: true`, enforced by buy
// paths but not by a grant — Pray has to enforce it itself. See grantXom below.
const BELIEF_GROUP_SLUG = "general-beliefs";

// The one Belief Xom will not take off somebody: {tag:thanati} is the cult's
// membership card, and dropping it would quietly pull a cultist out of their
// objectives, rites and hideout. Refused instead — the cult got there first.
// A GM strips it by hand, like every other absolute block in the catalog.
const THANATI_SLUG = "thanati";

// Slugs the table hands out, named so db/test/xom.test.js can assert the pass and table agree.
const FECES_SLUG = "feces";
const CAVE_RAT_SLUG = "skinned-cave-rat";
const RAVENHEART_RED_SLUG = "ravenheart-red";
const GRENADE_SLUG = "fragmentation-grenade";
const SEIZURE_SLUG = "seizure";
const MADNESS_SLUG = "madness";
const MELEE_LEGENDARY_SLUG = "melee-legendary";
const RAGE_SLUG = "rage";

// THE TABLE. Bascinet's numbers, verbatim and unnormalised — weights, not
// percentages, and they don't sum to 100 on purpose. Never rewrite as
// percentages: a later edit would have to re-balance twelve rows to change one.
// lonely: teleport + conversation with a random living character, no-op if
// nobody else. madness: every clergy character at once; the half-unit is why
// the table isn't repeated entries.
const XOM_OUTCOMES = Object.freeze([
  Object.freeze({ id: "nothing", weight: 50 }),
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
  Object.freeze({ id: "madness", weight: 0.5 }),
]);

const XOM_TOTAL_WEIGHT = XOM_OUTCOMES.reduce((sum, row) => sum + row.weight, 0);

// The seven things a Xom-holder shouts. Bascinet's words — no.
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

// A cumulative walk, taking `rng` so a test can force any row. Pure on purpose.
function pickXomOutcome(rng = Math.random) {
  let roll = rng() * XOM_TOTAL_WEIGHT;
  for (const row of XOM_OUTCOMES) {
    roll -= row.weight;
    // `< 0` not `<= 0`: a roll on a boundary belongs to the row AFTER it, keeping a zero-weight row unreachable.
    if (roll < 0) return row.id;
  }
  // Floating-point can leave the last subtraction at exactly 0 — the final row is the answer, never a throw.
  return XOM_OUTCOMES[XOM_OUTCOMES.length - 1].id;
}

function pickShout(rng = Math.random) {
  return XOM_SHOUTS[Math.floor(rng() * XOM_SHOUTS.length)] ?? XOM_SHOUTS[0];
}

// What Pray does, shared by the bot handler and the web server action so the
// two faces can never drift. Returns { ok, already, spoken, replaced }.
// THE REPLACE IS DELIBERATE: Tag.exclusive is enforced only by the buy paths,
// not here, and replace is the only option that reads right in fiction — a
// god of disorder takes your old faith off you.
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

    // Every one, not just the first: two exclusive Beliefs on one sheet is legitimate, and both must come off.
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
