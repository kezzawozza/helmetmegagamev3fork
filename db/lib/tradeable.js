// "Is this thing cargo?" — the one predicate, in a leaf with ZERO requires so
// both faces can read it. It lived in web/lib/tagRequests.js until Search
// (docs/systemdocs/SEARCH.md) needed the same answer from db/lib, which cannot
// import from web/. Open-coding `Boolean(tag.tradeable)` over there instead is
// exactly the drift TAGS.md §5 names this function to prevent, so the function
// moved and web/lib/tagRequests.js re-exports it.
//
// Zero requires is the db/lib/hoodToken.js and db/lib/dmKinds.js rule: this is
// reachable from a client component, and one require of @lifeweb/db here drags
// PrismaClient into the browser bundle.
function isTradeable(tag) {
  return Boolean(tag?.tradeable);
}

module.exports = { isTradeable };
