// node --test over the two pure rules escorting is made of: who may be taken
// along (db/lib/escort.js#escortAuthority) and what taking them costs
// (db/lib/locationTravel.js#freeZoneMoves). Both are where the rules actually
// live — everything else in the feature is plumbing around these answers.
//
// Run with: npm test --workspace=db
const test = require("node:test");
const assert = require("node:assert/strict");
const { escortAuthority, escortReason, escortRefusal, ESCORT_SELECT } = require("../lib/escort");
const { freeZoneMoves, freeMovesLeft, fitsMount, CHARACTER_SELECT } = require("../lib/locationTravel");
const { equippedSlugs } = require("../lib/mounts");

const HERE = "loc-1";
const leader = (over = {}) => ({
  id: "L",
  locationId: HERE,
  isLeader: true,
  factionId: "f1",
  faction: { slug: "reeves" },
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

// --- who follows ----------------------------------------------------------

test("a body and the helpless come without asking", () => {
  assert.equal(escortAuthority(leader(), person({ status: "DEAD" })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ tags: [tag("bound", "Bound")] })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ tags: [tag("catatonic-afk", "Catatonic")] })), "FORCED");
});

test("a leader commands their own faction, and nobody else's", () => {
  assert.equal(escortAuthority(leader(), person({ factionId: "f1" })), "FORCED");
  assert.equal(escortAuthority(leader(), person({ factionId: "f2" })), "ASK");
  assert.equal(escortAuthority(leader({ isLeader: false }), person({ factionId: "f1" })), "ASK");
});

test("a Leader of Unaffiliated commands nobody — it is not a faction", () => {
  const unaffiliated = leader({ faction: { slug: "unaffiliated" } });
  assert.equal(escortAuthority(unaffiliated, person({ factionId: "f1" })), "ASK");
});

test("faction authority needs the faction RELATION, not just its id", () => {
  // The trap this guards: locationTravel's CHARACTER_SELECT loaded factionId
  // alone, so isUnaffiliated(undefined) came back true and every faction
  // leader was quietly refused. ESCORT_SELECT loads the relation for this.
  const noRelation = leader({ faction: undefined });
  assert.equal(escortAuthority(noRelation, person({ factionId: "f1" })), "ASK");
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
  assert.equal(escortAuthority(leader(), person({ escortedById: "Z", factionId: "f2" })), null);
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
  assert.equal(escortAuthority(leader(), person({ escortedById: "Z", factionId: "f1" })), "FORCED");
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

test("a hood is off the list, the way it is off every other picker", () => {
  assert.equal(escortAuthority(leader(), person({ concealed: true })), null);
  // But a corpse cannot hold a hood up, so the dead still show.
  assert.equal(escortAuthority(leader(), person({ status: "DEAD", concealed: true })), "FORCED");
});

test("the reason says why they follow, not why they cannot", () => {
  assert.equal(escortReason(person({ status: "DEAD" }), "FORCED"), "a body");
  assert.equal(escortReason(person({ tags: [tag("bound", "Bound")] }), "FORCED"), "bound");
  assert.equal(escortReason(person({ factionId: "f1" }), "FORCED"), "your faction");
  assert.equal(escortReason(person(), "CONSENTED"), "willing");
});

// --- what they cost -------------------------------------------------------

const held = (...slugs) => ({ tags: slugs.map((slug) => ({ equipped: true, tag: { slug, name: slug } })) });
const CONFIG = { freeZoneMovesPerTurn: 1 };
const allowance = (character, partySize) => freeZoneMoves(character, CONFIG, null, partySize);

test("on foot, any number of people is free", () => {
  // There is no bonus to lose without a mount, so the seat rule never bites.
  assert.equal(allowance(held(), 0), 1);
  assert.equal(allowance(held(), 1), 1);
  assert.equal(allowance(held(), 12), 1);
});

test("a mount buys its extra crossing only while the party fits its seats", () => {
  // fastTravelCapacity counts the RIDER, so a horse's 2 seats are one saddle
  // for you and one for somebody else.
  assert.equal(allowance(held("horse"), 0), 2);
  assert.equal(allowance(held("horse"), 1), 2);
  assert.equal(allowance(held("horse"), 2), 1);
  assert.equal(allowance(held("motorcycle"), 1), 2);
  assert.equal(allowance(held("motorcycle"), 2), 1);
});

test("a cart upgrades the horse's pair to six, and cannot reach the motorcycle", () => {
  assert.equal(allowance(held("horse", "cart"), 5), 2);
  assert.equal(allowance(held("horse", "cart"), 6), 1);
  // A hand-cart towed behind a motorcycle is not a thing (db/lib/mounts.js).
  assert.equal(allowance(held("motorcycle", "cart"), 2), 1);
});

test("an overloaded mount is never WORSE than legs, only no better", () => {
  assert.equal(allowance(held("horse"), 9), allowance(held(), 9));
});

test("a stowed mount seats nobody, because it is not out", () => {
  const stowed = { tags: [{ equipped: false, tag: { slug: "horse", name: "horse" } }] };
  assert.equal(allowance(stowed, 0), 1);
});

test("Overburdened still takes the lot, party or no party", () => {
  assert.equal(allowance(held("horse", "overburdened"), 0), 0);
});

test("fitsMount says nothing is overfull when there are no seats", () => {
  assert.equal(fitsMount(equippedSlugs([]), 40), true);
  assert.equal(fitsMount(equippedSlugs(held("horse").tags), 1), true);
  assert.equal(fitsMount(equippedSlugs(held("horse").tags), 2), false);
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
// rider who stables their horse at an indoors door lost a crossing they had
// never spent: the allowance is recomputed every time, so the horse's move
// went away and the base move was already gone.
const TURN = { id: "t1" };
const after = (character, spent, bonusSpent, partySize = 0) =>
  freeMovesLeft(
    { ...character, zoneMovesTurnId: TURN.id, zoneMovesUsed: spent, zoneMovesBonusUsed: bonusSpent },
    CONFIG,
    TURN,
    partySize,
  );

test("a rider who parks their horse indoors keeps the crossing they never spent", () => {
  // Two before, one charged to the horse, then the horse is unequipped at the
  // door — the base crossing is still there.
  assert.equal(freeMovesLeft(held("horse"), CONFIG, TURN), 2);
  assert.equal(after(held("horse"), 1, 1), 1);
  assert.equal(after(held(), 1, 1), 1);
});

test("the base crossing is charged only once the bonus is gone", () => {
  assert.equal(after(held("horse"), 2, 1), 0);
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
  assert.equal(freeMovesLeft(held("horse"), CONFIG, null), 2);
  assert.equal(freeMovesLeft(held(), CONFIG, null), 1);
});

test("last turn's counters do not follow you into this one", () => {
  const yesterday = { ...held("horse"), zoneMovesTurnId: "t0", zoneMovesUsed: 2, zoneMovesBonusUsed: 1 };
  assert.equal(freeMovesLeft(yesterday, CONFIG, TURN), 2);
});
