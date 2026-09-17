// node --test over the two pure rules escorting is made of: who may be taken
// along (db/lib/escort.js#escortAuthority) and what taking them costs
// (db/lib/locationTravel.js#freeZoneMoves). Both are where the rules actually
// live — everything else in the feature is plumbing around these answers.
//
// Run with: npm test --workspace=db
const test = require("node:test");

process.env.AUTH_SECRET ||= "test-secret-for-hood-tokens";
const assert = require("node:assert/strict");
const { escortAuthority, escortReason, escortRefusal, escortName, escortKey, escortHidden, ESCORT_SELECT } = require("../lib/escort");
const { freeZoneMoves, freeMovesLeft, fitsMount, CHARACTER_SELECT } = require("../lib/locationTravel");
const { equippedSlugs } = require("../lib/mounts");

const HERE = "loc-1";
const leader = (over = {}) => ({
  id: "L",
  locationId: HERE,
  ...over,
});
const person = (over = {}) => ({
  id: "P",
  locationId: HERE,
  status: "ALIVE",
  tags: [],
  ...over,
});
const tag = (slug, name) => ({ tag: { slug, name } });
const maskTag = () => ({
  tagId: "mask",
  equipped: true,
  tag: {
    id: "mask",
    slug: "knights-helmet",
    name: "Knight's Helmet",
    concealsIdentity: true,
    concealSprite: "helm",
    forcesConceal: false,
    equipLayer: 1,
    forcedName: null,
  },
});

// --- who follows ----------------------------------------------------------

test("a body and the helpless come without asking", () => {
  assert.equal(escortAuthority(leader(), person({ status: "DEAD" })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ tags: [tag("bound", "Bound")] })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ tags: [tag("catatonic-afk", "Catatonic")] })), "FORCED");
});

test("nobody outranks anybody: a healthy, conscious person is always asked", () => {
  // Factions used to make this a FORCED verdict for a Leader over their own
  // members. There is no rank left that walks somebody anywhere.
  assert.equal(escortAuthority(leader(), person()), "ASK");
  assert.equal(escortAuthority(leader(), person({ status: "ALIVE" })), "ASK");
});

test("anyone else living gets asked", () => {
  assert.equal(escortAuthority(leader(), person()), "ASK");
});

test("consent counts, and only until its window lapses", () => {
  const willing = person({ escortConsentToId: "L", escortConsentUntilTurn: 12 });
  assert.equal(escortAuthority(leader(), willing, 11), "CONSENTED");
  assert.equal(escortAuthority(leader(), willing, 12), "CONSENTED");
  assert.equal(escortAuthority(leader(), willing, 13), "ASK");
  // A yes said to somebody else is not a yes said to you.
  assert.equal(escortAuthority(leader(), person({ escortConsentToId: "X", escortConsentUntilTurn: 99 }), 1), "ASK");
  // No open turn means no window can be read, which has to fall back to
  // asking rather than to attaching.
  assert.equal(escortAuthority(leader(), willing, null), "ASK");
});

test("nobody is taken from across the map, from the ground, or off a friend", () => {
  assert.equal(escortAuthority(leader(), person({ locationId: "loc-2" })), null);
  assert.equal(escortAuthority(leader(), person({ status: "DEAD", buriedAt: new Date() })), null);
  // A WILLING follower is somebody else's, and stays theirs.
  assert.equal(escortAuthority(leader(), person({ escortedById: "Z" })), null);
  // Already yours is still yours.
  assert.equal(escortAuthority(leader(), person({ escortedById: "L" })), "ASK");
  assert.equal(escortAuthority(leader(), person({ id: "L" })), null);
  assert.equal(escortAuthority(leader({ locationId: null }), person()), null);
});

test("force beats an arrangement: a captor takes their prisoner off whoever has them", () => {
  // The reported bug. Tie somebody up while they are walking with a friend
  // and the friend used to keep them, because the escortedById guard ran
  // before the FORCED branches ever did.
  assert.equal(escortAuthority(leader(), person({ escortedById: "Z", tags: [tag("bound", "Bound")] })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ escortedById: "Z", status: "DEAD" })), "FORCED");
  // Consent is not force: a standing agreement to YOU does not outrank
  // somebody who is holding them right now.
  assert.equal(
    escortAuthority(leader(), person({ escortedById: "Z", escortConsentToId: "L", escortConsentUntilTurn: 9 }), 3),
    null,
  );
});

test("a refusal says which rule refused", () => {
  assert.equal(escortRefusal(leader(), person({ escortedById: "Z" })), "They're already with somebody.");
  assert.equal(escortRefusal(leader(), person({ locationId: "loc-2", name: "Ada" })), "Ada isn't here.");
  assert.equal(escortRefusal(leader(), null), "They aren't here any more.");
  // Yours is not a refusal at all, so it falls through to the flat wording
  // rather than claiming somebody else has them.
  assert.equal(escortRefusal(leader(), person({ escortedById: "L" })), "You can't take them along.");
});

test("a passenger cannot bring anyone along themselves", () => {
  // The reported bug: somebody already being brought along could still open
  // their own picker and attach followers of their own, leaving an orphaned
  // sub-party once they walked with their own leader.
  const passenger = leader({ escortedById: "Z" });
  assert.equal(escortAuthority(passenger, person()), null);
  // No exception for FORCED — a passenger cannot drive even a corpse, or the
  // helpless off somebody else, while being carried themselves.
  assert.equal(escortAuthority(passenger, person({ status: "DEAD" })), null);
  assert.equal(escortAuthority(passenger, person({ tags: [tag("bound", "Bound")] })), null);
  assert.equal(escortRefusal(passenger, person()), "You're being brought along yourself.");
});

// A hood hides WHO somebody is, never THAT they are standing there, and hauling
// a stranger along is one of the plainest things you can do to somebody whose
// name you do not know (PROXYING.md §5). It used to refuse outright, which meant
// a masked friend bleeding out could not be carried to a surgeon by anybody.
// What a hood still costs is the NAME, and that is escortName's job.
test("a hood comes along like anybody else — the mask costs the name, not the ride", () => {
  const masked = person({ concealed: true, tags: [maskTag()] });
  assert.equal(escortAuthority(leader(), masked), "ASK");
  assert.equal(escortAuthority(leader(), person({ concealed: true, tags: [maskTag(), tag("bound", "Bound")] })), "FORCED");
});

test("no list ever prints the name under the mask", () => {
  const masked = person({ name: "Sir Alder", concealed: true, age: 20, gender: "MAN", tags: [maskTag()] });
  assert.equal(escortHidden(masked), true);
  assert.equal(escortName(masked), "a young man");
  assert.ok(!escortKey(masked).includes("P"), "a hood is keyed by token, never by id");

  const bare = person({ name: "Ann Vell" });
  assert.equal(escortHidden(bare), false);
  assert.equal(escortName(bare), "Ann Vell");
  assert.equal(escortKey(bare), "character:P");
});

// Death unequips, so a body's mask is REMEMBERED rather than worn
// (Character.deathMaskTagId, CORPSES.md §1b). Note the rows below: not equipped.
test("a body keeps its mask until somebody takes it", () => {
  const stamped = (tags) =>
    person({ name: "Sir Alder", status: "DEAD", age: 20, gender: "MAN", deathMaskTagId: "mask", tags });
  const worn = { tagId: "mask", equipped: false, tag: { ...maskTag().tag, id: "mask" } };

  assert.equal(escortName(stamped([worn])), "a young man");
  assert.equal(escortName(stamped([])), "Sir Alder", "looted: the face comes back");
  assert.equal(escortName(person({ name: "Ann Vell", status: "DEAD" })), "Ann Vell", "never wore one");
});

test("a forced name is not a hood, however much is over the face", () => {
  const beast = person({
    name: "Jorren Vask",
    concealed: true,
    tags: [maskTag(), { tagId: "apex", equipped: true, tag: { slug: "apex-form", name: "Apex Form", forcedName: "Beast" } }],
  });
  assert.equal(escortHidden(beast), false);
  assert.equal(escortName(beast), "Beast");
});

test("the reason says why they follow, not why they cannot", () => {
  assert.equal(escortReason(person({ status: "DEAD" }), "FORCED"), "a body");
  assert.equal(escortReason(person({ tags: [tag("bound", "Bound")] }), "FORCED"), "bound");
  assert.equal(escortReason(person(), "CONSENTED"), "willing");
});

// --- what they cost -------------------------------------------------------

const held = (...slugs) => ({ tags: slugs.map((slug) => ({ equipped: true, tag: { slug, name: slug } })) });
const CONFIG = { freeZoneMovesPerTurn: 1 };
const allowance = (character, partySize) => freeZoneMoves(character, CONFIG, partySize);

test("on foot, any number of people is free", () => {
  // There is no bonus to lose without a mount, so the seat rule never bites.
  assert.equal(allowance(held(), 0), 1);
  assert.equal(allowance(held(), 1), 1);
  assert.equal(allowance(held(), 12), 1);
});

test("a mount buys its extra crossing only while the party fits its seats", () => {
  // fastTravelCapacity counts the RIDER, so an arelitz's 2 seats are one saddle
  // for you and one for somebody else.
  assert.equal(allowance(held("arelitz"), 0), 2);
  assert.equal(allowance(held("arelitz"), 1), 2);
  assert.equal(allowance(held("arelitz"), 2), 1);
  assert.equal(allowance(held("motorcycle"), 1), 2);
  assert.equal(allowance(held("motorcycle"), 2), 1);
});

test("a cart upgrades the arelitz's pair to six, and cannot reach the motorcycle", () => {
  assert.equal(allowance(held("arelitz", "cart"), 5), 2);
  assert.equal(allowance(held("arelitz", "cart"), 6), 1);
  // A hand-cart towed behind a motorcycle is not a thing (db/lib/mounts.js).
  assert.equal(allowance(held("motorcycle", "cart"), 2), 1);
});

test("an overloaded mount is never WORSE than legs, only no better", () => {
  assert.equal(allowance(held("arelitz"), 9), allowance(held(), 9));
});

test("a stowed mount seats nobody, because it is not out", () => {
  const stowed = { tags: [{ equipped: false, tag: { slug: "arelitz", name: "arelitz" } }] };
  assert.equal(allowance(stowed, 0), 1);
});

test("Overburdened still takes the lot, party or no party", () => {
  assert.equal(allowance(held("arelitz", "overburdened"), 0), 0);
});

test("fitsMount says nothing is overfull when there are no seats", () => {
  assert.equal(fitsMount(equippedSlugs([]), 40), true);
  assert.equal(fitsMount(equippedSlugs(held("arelitz").tags), 1), true);
  assert.equal(fitsMount(equippedSlugs(held("arelitz").tags), 2), false);
});

// --- the select ----------------------------------------------------------

test("ESCORT_SELECT stays a superset of what performLocationMove needs", () => {
  // Every caller now loads a mover with ESCORT_SELECT and hands that row to
  // performLocationMove. Drop a field and the failure is silent and ugly:
  // without zoneMoves* the free-crossing claim reads zero spent every time
  // and never runs out.
  const missing = Object.keys(CHARACTER_SELECT).filter((key) => !(key in ESCORT_SELECT));
  assert.deepEqual(missing, []);
});

// --- what is LEFT after a crossing ---------------------------------------

// The bonus a mount (or a boat, on the water) buys is spent BEFORE the base
// allowance, and Character.zoneMovesBonusUsed remembers that. Without it, a
// rider who stables their arelitz at an indoors door lost a crossing they had
// never spent: the allowance is recomputed every time, so the arelitz's move
// went away and the base move was already gone.
const TURN = { id: "t1" };
const after = (character, spent, bonusSpent, partySize = 0) =>
  freeMovesLeft(
    { ...character, zoneMovesTurnId: TURN.id, zoneMovesUsed: spent, zoneMovesBonusUsed: bonusSpent },
    CONFIG,
    TURN,
    partySize,
  );

test("a rider who parks their arelitz indoors keeps the crossing they never spent", () => {
  // Two before, one charged to the arelitz, then the arelitz is unequipped at the
  // door — the base crossing is still there.
  assert.equal(freeMovesLeft(held("arelitz"), CONFIG, TURN), 2);
  assert.equal(after(held("arelitz"), 1, 1), 1);
  assert.equal(after(held(), 1, 1), 1);
});

test("the base crossing is charged only once the bonus is gone", () => {
  assert.equal(after(held("arelitz"), 2, 1), 0);
  assert.equal(after(held(), 1, 0), 0);
});

test("a stale bonus count can never hand back more than the allowance", () => {
  // Overburdened after spending both: zero, not a negative that reads as one.
  assert.equal(after(held("overburdened"), 2, 1), 0);
  // Dismounted at a narrow way BEFORE the arithmetic, so nothing was charged
  // to a bonus and the base move is spent as it always was.
  assert.equal(after(held(), 1, 0), 0);
});

test("with no open turn the number is just the allowance", () => {
  assert.equal(freeMovesLeft(held("arelitz"), CONFIG, null), 2);
  assert.equal(freeMovesLeft(held(), CONFIG, null), 1);
});

test("last turn's counters do not follow you into this one", () => {
  const yesterday = { ...held("arelitz"), zoneMovesTurnId: "t0", zoneMovesUsed: 2, zoneMovesBonusUsed: 1 };
  assert.equal(freeMovesLeft(yesterday, CONFIG, TURN), 2);
});
