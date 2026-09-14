// A cache of tags the economy ledger cares about: priced tags plus the obol tag, worth exactly 1 ⬢ by definition (db/lib/depotState.js). tagWrites.js calls `pricedTag` on ~135 hot-path write call sites, so this is a lazily-loaded, process-memory Map with a TTL short enough to pick up a `db:sync-tags` run without a restart.
// Takes `tx`/`prisma` as a parameter rather than requiring db/index.js back — the db/lib/dm.js convention, since requiring the barrel from inside db/lib/ resolves to a partial exports object.
const { OBOL_SLUG } = require("./depotState");

const TTL_MS = 5 * 60 * 1000;

// Module-level, not per-tx: survives across calls/transactions; reset only by TTL expiry or an explicit invalidate.
let cache = null; // Map<tagId, entry>
let loadedAt = 0;

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

// Returns a priced-tag record or null (including on any failure) — a bookkeeping miss must never cost a player their item, so this NEVER throws into a caller.
async function pricedTag(tx, tagId) {
  if (!tagId) return null;
  try {
    if (!isFresh()) {
      // NOT shared across callers, deliberately — an in-flight promise reused across transactions would tie a second tx to the first one's connection, so a rollback on one wrongly errors the other. A few duplicate reads per TTL is the cheaper mistake.
      await loadCache(tx);
    }
    return cache?.get(tagId) ?? null;
  } catch (err) {
    console.error("[pricedTags] lookup failed:", err?.message ?? err);
    return null;
  }
}

module.exports = { pricedTag };
