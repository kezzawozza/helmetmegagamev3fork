// Each minable Location carries one LocationMining row; `current`
// (world-drifted from `base`) is the only number a payout reads — no row
// means you cannot dig there. Mean-reverting random walk with occasional
// jump events (docs/systemdocs/MINING.md):
//   target  = in an event ? eventTarget : base
//   current = clamp(current + reversion * (target - current) + noise, 0, CAP)
// An event moves the TARGET, not `current` — swings arrive over turns and
// decay on their own once the window closes; no separate recovery path.
//
// There were four sets of these parameters once, one per Laboring kind, and
// farming's rolled a single world-wide event so a blight hit every field at
// once. Mining is the only kind left and a seam runs out one seam at a time,
// so the global-event path went with the rest of Laboring.

const YIELD_CAP = 2;
const YIELD_FLOOR = 0;

// `reversion`/`sigma` steady-state spread ~ sigma / sqrt(2 * reversion):
// 0.13/sqrt(0.44) ~ ±0.20. `eventChance` is per row, per turn.
const MINING_PARAMS = {
  reversion: 0.22,
  sigma: 0.13,
  eventChance: 0.05,
  eventLength: [3, 9],
  magnitude: [0.2, 2],
};

function clampYield(value) {
  return Math.max(YIELD_FLOOR, Math.min(YIELD_CAP, value));
}

function gaussian(rng = Math.random) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function randBetween(lo, hi, rng = Math.random) {
  return lo + rng() * (hi - lo);
}

function randIntBetween(lo, hi, rng = Math.random) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function rollEvent(base, rng = Math.random) {
  if (rng() >= MINING_PARAMS.eventChance) return null;
  const multiplier = randBetween(MINING_PARAMS.magnitude[0], MINING_PARAMS.magnitude[1], rng);
  return {
    target: clampYield(base * multiplier),
    length: randIntBetween(MINING_PARAMS.eventLength[0], MINING_PARAMS.eventLength[1], rng),
  };
}

function driftRow(row, turn, { rng = Math.random } = {}) {
  let eventTarget = row.eventTarget;
  let eventUntilTurn = row.eventUntilTurn;

  // Cleared before anything else, so the pull goes back to `base` the turn the event ends, not a turn later.
  if (eventUntilTurn != null && turn >= eventUntilTurn) {
    eventTarget = null;
    eventUntilTurn = null;
  }

  if (eventUntilTurn == null) {
    const started = rollEvent(row.base, rng);
    if (started) {
      eventTarget = started.target;
      eventUntilTurn = turn + started.length;
    }
  }

  const target = eventTarget ?? row.base;
  const current = clampYield(
    row.current + MINING_PARAMS.reversion * (target - row.current) + gaussian(rng) * MINING_PARAMS.sigma,
  );

  return { current, eventTarget, eventUntilTurn };
}

// Pure — takes rows, returns the writes to make — so the turn pass below is just the database half; a simulation can call this directly.
function driftAll(rows, turn, { rng = Math.random } = {}) {
  const updates = [];
  for (const row of rows) {
    const next = driftRow(row, turn, { rng });
    if (!next) continue;
    // Tolerance, not float equality (which would never hit) — keeps a no-op turn from writing every row.
    const unchanged =
      Math.abs(next.current - row.current) < 1e-9 &&
      next.eventTarget === row.eventTarget &&
      next.eventUntilTurn === row.eventUntilTurn;
    if (unchanged) continue;
    updates.push({ id: row.id, ...next });
  }
  return updates;
}

// Registered in db/index.js's TURN_PASSES, which keeps this random, non-idempotent pass from drifting twice on a resumed turn advance. It runs late on purpose: what it writes is what the NEXT turn's mining is worth, so a day already paid keeps the coefficient it was priced at.
async function runMiningYieldPass(prisma, turn) {
  const rows = await prisma.locationMining.findMany({
    select: { id: true, base: true, current: true, eventTarget: true, eventUntilTurn: true },
  });
  if (rows.length === 0) return { turnNumber: turn.number, drifted: 0, events: 0 };

  const updates = driftAll(rows, turn.number);
  // Sequential, not one big transaction: partial application is harmless — a row that missed a turn's drift just stood still.
  let events = 0;
  for (const update of updates) {
    const { id, ...data } = update;
    if (data.eventUntilTurn != null && data.eventUntilTurn > turn.number) events += 1;
    await prisma.locationMining.update({ where: { id }, data }).catch((err) => {
      console.error(`Mining yield drift failed for row ${id}:`, err);
    });
  }

  return { turnNumber: turn.number, drifted: updates.length, events };
}

// Bountiful is deliberately hard to reach.
const QUALITY_WORDS = [
  { below: 0.3, word: "Barren" },
  { below: 0.6, word: "Scarce" },
  { below: 0.9, word: "Modest" },
  { below: 1.2, word: "Sufficient" },
  { below: 1.55, word: "Ample" },
  { below: Infinity, word: "Bountiful" },
];

function qualityWord(current) {
  if (current == null || current <= 0) return "×";
  return QUALITY_WORDS.find((step) => current < step.below).word;
}

module.exports = {
  YIELD_CAP,
  YIELD_FLOOR,
  MINING_PARAMS,
  clampYield,
  driftRow,
  driftAll,
  runMiningYieldPass,
  qualityWord,
};
