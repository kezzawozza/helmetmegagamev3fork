// The cargo train, and the clock it runs on.
//
// It replaces the shuttle, and the difference that matters is that NOBODY CALLS
// IT. The shuttle was a button: goods sat paid-for and undelivered until the
// Merchant woke up and pressed it, which with one real day to a turn meant a
// day of nothing moving. The train is weather. It rolls in every other turn,
// and what is staged when it does is what rides it.
//
// Pure constants and helpers — no Prisma, no network — so both faces and the
// passes can read it. See docs/systemdocs/DEPOT.md §0d.

// Where it stops. A ROOM slug (docs/zones.yaml), under the Depot location, and
// it must follow whichever Location the platforms sit in — get this wrong and
// every delivery reports that a GM needs to run the zone sync.
const RAILYARD_ROOM_SLUG = "depot-railyard";

// The Merchant's own room, where the station's counter is and where the ATM
// hangs. Named here rather than imported from depot.js so the affordance
// catalog can reach it without pulling the price tables in.
const STOREFRONT_ROOM_SLUG = "depot-storefront";
const MERCHANTS_OFFICE_ROOM_SLUG = "depot-merchants-office";

// Turn parity, and it is about what happens at the turn's CLOSE, not about
// where the train is standing while the turn is open. Closing an EVEN turn
// rolls it in and unloads; closing an ODD turn loads it and pulls it out.
//
// So turn 1 is a departure close with an empty drop box and nothing to load,
// and turn 2's close is the first arrival — which brings down whatever was
// ordered on turn 1. That is the shape Bascinet asked for, and it falls out of
// the parity rather than needing a first-turn special case in either pass.
const ARRIVAL_PARITY = 0;

function isArrivalTurn(turnNumber) {
  return Math.trunc(turnNumber ?? 0) % 2 === ARRIVAL_PARITY;
}

function isDepartureTurn(turnNumber) {
  return !isArrivalTurn(turnNumber);
}

// Whether the train is STANDING THERE right now, which is a different question
// from which half of the cycle this turn's close will run.
//
// It rolls in at the close of an even turn and pulls out at the close of the
// odd turn after it, so it is at the platform for the length of an odd turn —
// with turn 1 the one exception, because nothing has arrived yet. Get this
// backwards and the Railyard's starter post tells everybody the train is in
// on the very turn it demonstrably is not.
function trainHere(turnNumber) {
  const n = Math.trunc(turnNumber ?? 0);
  return n > 1 && isDepartureTurn(n);
}

// What the console's little train icon says, and what the Railyard's starter
// post says, so the two can never disagree. `turnNumber` is the OPEN turn.
function trainState(turnNumber) {
  const n = Math.trunc(turnNumber ?? 0);
  if (trainHere(n)) {
    return { here: true, label: "at the platform", nextLabel: "leaves at the end of this turn" };
  }
  if (isArrivalTurn(n)) {
    return { here: false, label: "away", nextLabel: "arrives at the end of this turn" };
  }
  // Turn 1, and only turn 1: nothing has run yet.
  return { here: false, label: "not in yet", nextLabel: "first arrives at the end of the next turn" };
}

module.exports = {
  RAILYARD_ROOM_SLUG,
  STOREFRONT_ROOM_SLUG,
  MERCHANTS_OFFICE_ROOM_SLUG,
  ARRIVAL_PARITY,
  isArrivalTurn,
  isDepartureTurn,
  trainHere,
  trainState,
};
