// Each Location carries up to four LocationYield rows (one per LaborKind);
// `current` (world-drifted from `base`) is the only number a payout reads —
// no row means labor is impossible there. Mean-reverting random walk with
// occasional jump events (docs/systemdocs/LABORING.md):
//   target  = in an event ? eventTarget : base
//   current = clamp(current + reversion * (target - current) + noise, 0, CAP)
// An event moves the TARGET, not `current` — swings arrive over turns and
// decay on their own once the window closes; no separate recovery path.

const YIELD_CAP = 2;
const YIELD_FLOOR = 0;

// `reversion`/`sigma` steady-state spread ~ sigma / sqrt(2 * reversion):
//   HUNTING 0.12/sqrt(0.60)~±0.16  FISHING 0.07/sqrt(0.40)~±0.11
//   FARMING 0.025/sqrt(0.24)~±0.05  PROSPECTING 0.13/sqrt(0.44)~±0.20
// `eventChance` is per row/turn, except FARMING's — rolled ONCE for the whole world (rollEvents), so a blight hits every field at once.
const KIND_PARAMS = {
  HUNTING: {
    reversion: 0.3,
    sigma: 0.12,
    eventChance: 0.06,
    eventLength: [2, 8],
    magnitude: [0.25, 2],
    global: false,
  },
  FISHING: {
    reversion: 0.2,
    sigma: 0.07,
    eventChance: 0.025,
    eventLength: [3, 10],
    magnitude: [0.5, 1.6],
    global: false,
  },
  FARMING: {
    reversion: 0.12,
    sigma: 0.025,
    eventChance: 0.018,
    eventLength: [8, 20],
    outcomes: [
      { multiplier: 1.5, weight: 40 },
      { multiplier: 0.55, weight: 60 },
    ],
    global: true,
  },
  // DRAFT — Bascinet's to retune.
  PROSPECTING: {
    reversion: 0.22,
    sigma: 0.13,
    eventChance: 0.05,
    eventLength: [3, 9],
    magnitude: [0.2, 2],
    global: false,
  },
};

const KINDS = Object.keys(KIND_PARAMS);

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

function pickOutcome(outcomes, rng = Math.random) {
  const total = outcomes.reduce((sum, o) => sum + o.weight, 0);
  let roll = rng() * total;
  for (const outcome of outcomes) {
    if (roll < outcome.weight) return outcome;
    roll -= outcome.weight;
  }
  return outcomes[outcomes.length - 1];
}

function rollEvent(params, base, rng = Math.random) {
  if (rng() >= params.eventChance) return null;
  const multiplier = params.outcomes
    ? pickOutcome(params.outcomes, rng).multiplier
    : randBetween(params.magnitude[0], params.magnitude[1], rng);
  return {
    target: clampYield(base * multiplier),
    length: randIntBetween(params.eventLength[0], params.eventLength[1], rng),
  };
}

// `globalEvent` is driftAll's once-per-turn farming event, so every row starts the same blight together.
function driftRow(row, turn, { rng = Math.random, globalEvent = null } = {}) {
  const params = KIND_PARAMS[row.kind];
  if (!params) return null;

  let eventTarget = row.eventTarget;
  let eventUntilTurn = row.eventUntilTurn;

  // Cleared before anything else, so the pull goes back to `base` the turn the event ends, not a turn later.
  if (eventUntilTurn != null && turn >= eventUntilTurn) {
    eventTarget = null;
    eventUntilTurn = null;
  }

  if (eventUntilTurn == null) {
    const started = params.global
      ? globalEvent && {
          target: clampYield(row.base * globalEvent.multiplier),
          length: globalEvent.length,
        }
      : rollEvent(params, row.base, rng);
    if (started) {
      eventTarget = started.target;
      eventUntilTurn = turn + started.length;
    }
  }

  const target = eventTarget ?? row.base;
  const current = clampYield(
    row.current + params.reversion * (target - row.current) + gaussian(rng) * params.sigma,
  );

  return { current, eventTarget, eventUntilTurn };
}

function rollGlobalEvent(rng = Math.random) {
  const params = KIND_PARAMS.FARMING;
  if (rng() >= params.eventChance) return null;
  return {
    multiplier: pickOutcome(params.outcomes, rng).multiplier,
    length: randIntBetween(params.eventLength[0], params.eventLength[1], rng),
  };
}

// Pure — takes rows, returns the writes to make — so the turn pass below is just the database half; a simulation can call this directly.
function driftAll(rows, turn, { rng = Math.random } = {}) {
  const globalEvent = rollGlobalEvent(rng);
  const updates = [];
  for (const row of rows) {
    const next = driftRow(row, turn, { rng, globalEvent });
    if (!next) continue;
    // Tolerance, not float equality (which would never hit) — keeps a no-op turn from writing 168 rows.
    const unchanged =
      Math.abs(next.current - row.current) < 1e-9 &&
      next.eventTarget === row.eventTarget &&
      next.eventUntilTurn === row.eventUntilTurn;
    if (unchanged) continue;
    updates.push({ id: row.id, ...next });
  }
  return updates;
}

// Runs AFTER auto-labor. Registered in db/index.js's TURN_PASSES, which keeps this random, non-idempotent pass from drifting twice on a resumed turn advance.
async function runLaborYieldPass(prisma, turn) {
  const rows = await prisma.locationYield.findMany({
    select: { id: true, kind: true, base: true, current: true, eventTarget: true, eventUntilTurn: true },
  });
  if (rows.length === 0) return { turnNumber: turn.number, drifted: 0, events: 0 };

  const updates = driftAll(rows, turn.number);
  // Sequential, not one big transaction: partial application is harmless — a row that missed a turn's drift just stood still.
  let events = 0;
  for (const update of updates) {
    const { id, ...data } = update;
    if (data.eventUntilTurn != null && data.eventUntilTurn > turn.number) events += 1;
    await prisma.locationYield.update({ where: { id }, data }).catch((err) => {
      console.error(`Labor yield drift failed for row ${id}:`, err);
    });
  }

  return { turnNumber: turn.number, drifted: updates.length, events };
}

// Bountiful is deliberately hard to reach — at base, only depths-obelisk wears it.
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
  KIND_PARAMS,
  KINDS,
  clampYield,
  driftRow,
  driftAll,
  rollGlobalEvent,
  runLaborYieldPass,
  qualityWord,
};
