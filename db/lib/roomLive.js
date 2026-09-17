// A line in a room's starter message that is read off live state. A Room's
// starter is written once and left alone, since prose about a place does not
// change — the Landing Pad is the exception, so a room may name a key from
// the registry below and the sync appends whatever it currently renders.
//
// Same shape as db/lib/locationAttributes.js: a registry of keys, a
// `describe`, and a sync-side check that rejects an unrecognised key. This
// one also has to LOAD, so each entry carries `load(prisma)` too — the
// module takes prisma as a parameter rather than requiring the barrel back
// (db/lib/dm.js).
//
// The line is BOLD rather than `-#` subtext: the paragraph above it is
// already italic.

const { trainHere } = require("./train");

// key -> { load(prisma) -> state, describe(state) -> string|null }
const LIVE = {
  // The Railyard: whether the train is standing at the platform. Read off the
  // open turn rather than a column, because that IS the train's state — there
  // is nothing to keep in step. Note it is trainHere() and NOT isArrivalTurn():
  // an arrival turn is one the train comes in at the END of, so on that turn
  // the platform is empty (db/lib/train.js).
  train: {
    load: async (prisma) => {
      const turn = await prisma.turn.findFirst({
        where: { closedAt: null },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      return { here: trainHere(turn?.number ?? 0) };
    },
    describe: (state) =>
      state?.here ? "**The train is at the platform.**" : "**The rails are empty.**",
  },
};

// Loads state for every key at once, so the sync hits the DB once per KIND of
// live line rather than once per room. An unknown key is simply absent.
async function loadLiveStates(prisma, keys) {
  const wanted = [...new Set([...keys].filter((key) => LIVE[key]))];
  const states = new Map();
  await Promise.all(
    wanted.map(async (key) => {
      states.set(key, await LIVE[key].load(prisma));
    }),
  );
  return states;
}

// Null for a room with no `live` key, an unknown key, or nothing to say.
function liveLine(key, state) {
  if (!key) return null;
  const entry = LIVE[key];
  if (!entry) return null;
  return entry.describe(state) || null;
}

// Sync-side validation, the twin of locationAttributes.js#collectAttributes.
function collectLive(raw, label, problems) {
  if (raw == null) return null;
  if (typeof raw !== "string" || !LIVE[raw]) {
    problems.push(`${label} has unknown live key "${raw}"`);
    return null;
  }
  return raw;
}

module.exports = {
  LIVE,
  loadLiveStates,
  liveLine,
  collectLive,
};
