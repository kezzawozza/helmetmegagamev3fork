// node --test over the half of the rite pipeline that touches a database:
// db/lib/riteSweep.js#fireAttempt and db/lib/riteEffects.js's handlers. Run
// with `npm test --workspace=db`.
//
// There was no coverage here at all, and that is why three bugs shipped on
// 2026-09-08 — a rite that threw whenever no turn was open, a rearm that could
// un-fire a rite that had already fired, and five handlers that ignored
// whether the thing they were spending was still there. Each of those is a
// test below.
//
// Prisma is faked rather than mocked wholesale: a tiny in-memory store with
// just the shapes these paths read and write. It is not a Prisma emulator and
// is not meant to be reused — when a test needs a query this fake does not
// answer, teach the fake that one query.
const test = require("node:test");
const assert = require("node:assert/strict");

const { fireAttempt } = require("../lib/riteSweep");

// ---- the fake ---------------------------------------------------------------

// Prisma's `where` subset these paths actually use: exact scalars, plus
// `{ gte }` on a number and `{ in }` on an id.
function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("gte" in cond && !(value >= cond.gte)) return false;
      if ("in" in cond && !cond.in.includes(value)) return false;
      if ("not" in cond && value === cond.not) return false;
      if ("decrement" in cond || "increment" in cond) continue;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if ("decrement" in value) row[key] = (row[key] ?? 0) - value.decrement;
      else if ("increment" in value) row[key] = (row[key] ?? 0) + value.increment;
      else row[key] = value;
    } else row[key] = value;
  }
  return row;
}

function makeDb({ attempt, rooms = [], roomTags = [], turns = [], characters = [], chants = [], tags = [] }) {
  // Any model not named here reads as empty rather than throwing — a handler
  // that reaches for a table this test does not care about (listObjectives,
  // say) should get "nothing there", not a TypeError that the sweep then
  // records as the rite failing.
  const store = new Proxy(
    {
      riteAttempt: [attempt],
      room: rooms,
      roomTag: roomTags,
      turn: turns,
      character: characters,
      riteChant: chants,
      tag: tags,
      auditLog: [],
      characterTag: [],
      gameState: [{ id: 1 }],
    },
    {
      get: (target, key) => {
        if (!(key in target)) target[key] = [];
        return target[key];
      },
    },
  );
  const model = (name) => ({
    findUnique: async ({ where }) => store[name].find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where = {}, orderBy } = {}) => {
      const rows = store[name].filter((r) => matches(r, where));
      const key = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (key) {
        const [field, dir] = Object.entries(key)[0];
        rows.sort((a, b) => (dir === "desc" ? (b[field] > a[field] ? 1 : -1) : a[field] > b[field] ? 1 : -1));
      }
      return rows[0] ?? null;
    },
    findMany: async ({ where = {} } = {}) => store[name].filter((r) => matches(r, where)),
    count: async ({ where = {} } = {}) => store[name].filter((r) => matches(r, where)).length,
    create: async ({ data }) => {
      const row = { id: `${name}-${store[name].length + 1}`, ...data };
      store[name].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = store[name].find((r) => matches(r, where));
      if (!row) throw new Error(`fake prisma: no ${name} matching ${JSON.stringify(where)}`);
      return applyData(row, data);
    },
    updateMany: async ({ where = {}, data }) => {
      const rows = store[name].filter((r) => matches(r, where));
      for (const row of rows) applyData(row, data);
      return { count: rows.length };
    },
    deleteMany: async ({ where = {} }) => {
      const keep = store[name].filter((r) => !matches(r, where));
      const count = store[name].length - keep.length;
      store[name] = keep;
      return { count };
    },
  });
  const db = new Proxy(
    { $transaction: async (fn) => fn(db), _store: store },
    { get: (target, key) => (key in target ? target[key] : model(String(key))) },
  );
  return db;
}

// A rite with no floor ingredients and no resolved kinds, so the pipeline runs
// end to end without a catalog. `initial` DMs its participants and nothing
// else, which makes it the quiet one to drive the state machine with.
function readyAttempt(overrides = {}) {
  return {
    id: "a1",
    riteKey: "initial",
    roomId: "r1",
    roomName: "The Basements",
    status: "READY",
    openedAt: new Date(),
    firesAt: new Date(Date.now() - 1000),
    firedAt: null,
    participants: null,
    result: null,
    ...overrides,
  };
}

const ROOM = {
  id: "r1",
  name: "The Basements",
  kind: "PUBLIC",
  locationId: "loc1",
  accessTagSlugs: [],
  discordThreadId: null,
  // floorHas selects the room's stacks alongside its ⬢ — ⬢ are the
  // `resources` tag now (db/lib/resourceStack.js), a stack like any other,
  // so a fixture wanting a floor balance adds one of these rather than a
  // bare `resources: N`.
  tags: [],
  location: { id: "loc1", name: "Underquarter", slug: "underquarter", zoneId: "z1", discordChannelId: null },
};

const CHANTER = { id: "c1", name: "Ash", discordUserId: null, status: "ALIVE" };

// ---- the tests --------------------------------------------------------------

test("a rite fires, is stamped FIRED, and records its participants", async () => {
  const attempt = readyAttempt();
  const db = makeDb({
    attempt,
    rooms: [ROOM],
    characters: [CHANTER],
    chants: [{ id: "ch1", attemptId: "a1", characterId: "c1", characterName: "Ash" }],
    turns: [{ id: "t1", number: 4, status: "OPEN" }],
  });

  const outcome = await fireAttempt(db, attempt);

  assert.equal(outcome.fired, true);
  assert.equal(attempt.status, "FIRED");
  assert.deepEqual(attempt.participants, [{ characterId: "c1", name: "Ash", discordUserId: null }]);
  assert.equal(db._store.auditLog.length, 1);
  assert.equal(db._store.auditLog[0].actionType, "rite_fired");
});

test("a rite fires with NO open turn — the 2026-09-08 Madness bug", async () => {
  // advanceTurn leaves nothing OPEN between resolving one turn and creating
  // the next, and the sweep is an independent minute cron, so it lands in that
  // window routinely. Anything that reads openTurn.number blindly throws here,
  // and by then the floor is already eaten.
  const attempt = readyAttempt();
  const db = makeDb({
    attempt,
    rooms: [ROOM],
    characters: [CHANTER],
    chants: [{ id: "ch1", attemptId: "a1", characterId: "c1", characterName: "Ash" }],
    turns: [{ id: "t1", number: 7, status: "RESOLVED" }],
  });

  const outcome = await fireAttempt(db, attempt);

  assert.equal(outcome.fired, true);
  assert.equal(attempt.status, "FIRED");
  assert.equal(attempt.result?.error, undefined, "the handler must not have thrown");
});

test("the grant turn is the turn ABOUT to open when none is open", async () => {
  // The number a timed tag needs. With turn 7 resolved and nothing open, a tag
  // granted now belongs to turn 8 — not 7, and certainly not null, which
  // grantTagSlugs refuses outright. The Rite of Madness is the one that grants
  // a timed tag; this checks the value the sweep hands every handler.
  const { EFFECTS } = require("../lib/riteEffects");
  const seen = [];
  const attempt = readyAttempt();
  const db = makeDb({
    attempt,
    rooms: [ROOM],
    characters: [CHANTER],
    chants: [{ id: "ch1", attemptId: "a1", characterId: "c1", characterName: "Ash" }],
    turns: [
      { id: "t0", number: 6, status: "RESOLVED" },
      { id: "t1", number: 7, status: "RESOLVED" },
    ],
  });

  const real = EFFECTS.initial;
  EFFECTS.initial = async (ctx) => {
    seen.push({ openTurn: ctx.openTurn, grantTurnNumber: ctx.grantTurnNumber });
    return { result: {} };
  };
  try {
    await fireAttempt(db, attempt);
  } finally {
    EFFECTS.initial = real;
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0].openTurn, null, "nothing is open mid-advance");
  assert.equal(seen[0].grantTurnNumber, 8, "the newest turn is 7, so a grant belongs to 8");
});

test("the grant turn is the open turn when there is one", async () => {
  const { EFFECTS } = require("../lib/riteEffects");
  const seen = [];
  const attempt = readyAttempt();
  const db = makeDb({
    attempt,
    rooms: [ROOM],
    characters: [CHANTER],
    chants: [{ id: "ch1", attemptId: "a1", characterId: "c1", characterName: "Ash" }],
    turns: [{ id: "t1", number: 4, status: "OPEN" }],
  });

  const real = EFFECTS.initial;
  EFFECTS.initial = async (ctx) => {
    seen.push(ctx.grantTurnNumber);
    return { result: {} };
  };
  try {
    await fireAttempt(db, attempt);
  } finally {
    EFFECTS.initial = real;
  }

  assert.deepEqual(seen, [4]);
});

test("a rearm cannot touch a rite another sweep already fired", async () => {
  // Two bot containers overlap on a rolling deploy. Sweep 2 resolves an
  // attempt while sweep 1 fires it, then finds the floor "missing" because
  // sweep 1 ate it. Without the status guard it stomped a FIRED row back to
  // OPEN, losing the result and leaving the chants in place to fire again.
  const attempt = readyAttempt({ riteKey: "scrying", status: "FIRED", result: { yielded: "scrying-eye" } });
  const db = makeDb({
    attempt,
    rooms: [{ ...ROOM, tags: [] }], // the floor is gone: sweep 1 ate it
    characters: [CHANTER, { id: "c2", name: "Bell", discordUserId: null, status: "ALIVE" }],
    chants: [
      { id: "ch1", attemptId: "a1", characterId: "c1", characterName: "Ash" },
      { id: "ch2", attemptId: "a1", characterId: "c2", characterName: "Bell" },
    ],
    turns: [{ id: "t1", number: 4, status: "OPEN" }],
  });

  const outcome = await fireAttempt(db, attempt);

  assert.equal(outcome.fired, false);
  assert.equal(outcome.rearmed, false, "nothing was rearmed, because the row was not READY");
  assert.equal(attempt.status, "FIRED", "the fired row is untouched");
  assert.deepEqual(attempt.result, { yielded: "scrying-eye" }, "and keeps its result");
});

test("a READY rite whose floor has gone is rearmed, and says what was missing", async () => {
  const attempt = readyAttempt({ riteKey: "scrying" });
  const db = makeDb({
    attempt,
    rooms: [{ ...ROOM, tags: [] }], // Scrying wants 15
    characters: [CHANTER, { id: "c2", name: "Bell", discordUserId: null, status: "ALIVE" }],
    chants: [
      { id: "ch1", attemptId: "a1", characterId: "c1", characterName: "Ash" },
      { id: "ch2", attemptId: "a1", characterId: "c2", characterName: "Bell" },
    ],
    turns: [{ id: "t1", number: 4, status: "OPEN" }],
  });

  const outcome = await fireAttempt(db, attempt);

  assert.equal(outcome.fired, false);
  assert.equal(outcome.rearmed, true);
  assert.equal(attempt.status, "OPEN");
  assert.equal(attempt.readyAt, null);
  assert.equal(attempt.firesAt, null);
  assert.deepEqual(attempt.result, { rearmed: ["floor"] });
});

test("a dead chanter does not count toward the minimum", async () => {
  const attempt = readyAttempt({ riteKey: "scrying" });
  const db = makeDb({
    attempt,
    rooms: [{ ...ROOM, tags: [{ quantity: 100, tag: { slug: "resources" } }] }],
    characters: [CHANTER, { id: "c2", name: "Bell", discordUserId: null, status: "DEAD" }],
    chants: [
      { id: "ch1", attemptId: "a1", characterId: "c1", characterName: "Ash" },
      { id: "ch2", attemptId: "a1", characterId: "c2", characterName: "Bell" },
    ],
    turns: [{ id: "t1", number: 4, status: "OPEN" }],
  });

  // Scrying needs two, and only one of the two is alive.
  const outcome = await fireAttempt(db, attempt);

  assert.equal(outcome.fired, false);
  assert.equal(attempt.status, "OPEN");
});

test("an attempt whose room is gone is cancelled, not fired", async () => {
  const attempt = readyAttempt({ roomId: "vanished" });
  const db = makeDb({ attempt, rooms: [], turns: [{ id: "t1", number: 4, status: "OPEN" }] });

  const outcome = await fireAttempt(db, attempt);

  assert.equal(outcome.fired, false);
  assert.equal(attempt.status, "CANCELLED");
});
