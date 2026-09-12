// A cache of the tags the economy ledger cares about: anything with a price
// (`sellablePrice` or `depotPrice`), plus the obol tag itself, which carries
// no price column but is worth exactly 1 ⬢ by definition (db/lib/depotState.js).
//
// db/lib/tagWrites.js calls `pricedTag` on every quantity write — addToStack,
// dropCharacterTag, and their room-stash twins — and there are on the order of
// 135 call sites feeding those four functions. An extra SELECT per write would
// put a query on that hot path for every wound, skill and corpse tag too, most
// of which will never price out to anything. So this is a lazily-loaded,
// process-memory Map instead: load once, then answer from memory, with a TTL
// short enough that a `db:sync-tags` run is picked up without a bot/web
// restart.
//
// Takes `tx`/`prisma` as a parameter rather than requiring db/index.js back —
// the db/lib/dm.js convention, since db/index.js is what requires THIS module,
// and requiring the barrel from inside db/lib/ resolves to a partial exports
// object.
const { OBOL_SLUG } = require("./depotState");

const TTL_MS = 5 * 60 * 1000;

// Module-level, not per-tx: the whole point is to survive across calls and
// across transactions. Reset only by TTL expiry or an explicit invalidate.
let cache = null; // Map<tagId, entry>
let loadedAt = 0;
let loading = null; // in-flight load promise, so concurrent misses share one query

function isFresh() {
  return cache && Date.now() - loadedAt < TTL_MS;
}

async function loadCache(tx) {
  const rows = await tx.tag.findMany({
    where: {
      OR: [{ sellablePrice: { not: null } }, { depotPrice: { not: null } }, { slug: OBOL_SLUG }],
    },
    select: { id: true, slug: true, sellablePrice: true, depotPrice: true, stackable: true },
  });
  const map = new Map();
  for (const row of rows) {
    map.set(row.id, {
      slug: row.slug,
      sellablePrice: row.sellablePrice ?? null,
      depotPrice: row.depotPrice ?? null,
      stackable: row.stackable,
      isObol: row.slug === OBOL_SLUG,
    });
  }
  cache = map;
  loadedAt = Date.now();
  return cache;
}

// Returns `{ slug, sellablePrice, depotPrice, stackable, isObol }` for a tag
// that carries money weight, or null for a tag that doesn't (or on any
// failure — a bookkeeping miss must never cost a player their item, so this
// NEVER throws into a caller).
async function pricedTag(tx, tagId) {
  if (!tagId) return null;
  try {
    if (!isFresh()) {
      // Share one in-flight load across concurrent callers instead of each
      // firing its own query the instant the TTL lapses.
      loading = loading ?? loadCache(tx).finally(() => (loading = null));
      await loading;
    }
    return cache?.get(tagId) ?? null;
  } catch (err) {
    console.error("[pricedTags] lookup failed:", err?.message ?? err);
    return null;
  }
}

// For `db:sync-tags` or a test to force a re-read on the next call, rather
// than waiting out the TTL.
function invalidatePricedTags() {
  cache = null;
  loadedAt = 0;
  loading = null;
}

module.exports = { pricedTag, invalidatePricedTags };
