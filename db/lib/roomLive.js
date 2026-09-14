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

const { loadDepot } = require("./depotState");

// key -> { load(prisma) -> state, describe(state) -> string|null }
const LIVE = {
  // The Landing Pad: whether the shuttle is docked.
  shuttle: {
    load: async (prisma) => {
      const depot = await loadDepot(prisma);
      return { docked: depot?.shuttleState === "DOCKED" };
    },
    describe: (state) => (state?.docked ? "**The shuttle is here.**" : "**It's empty.**"),
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
