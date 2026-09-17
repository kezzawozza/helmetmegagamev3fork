// The Merchant's Depot: shared constants and pure helpers behind /depot and the three DEPOT_* request
// kinds (docs/systemdocs/DEPOT.md). Lives in db/lib because the numbers are game balance, not page
// logic. Touches no Prisma/network, so it's safe on the barrel and safe from either face.

// The tag that opens the counter — the /depot route gate, the server-action re-check, and the reason
// the Depot's turret doesn't shoot you. Tradeable, so handing it away hands away the Depot.
const MERCHANT_LICENSE_SLUG = "merchants-license";

// The Merchant's ROLE (a seat, not the tradeable licence above). A slug predicate, same shape as
// db/lib/dynasty.js, since it's one role, not a role property. Tells the Depot's turret whose face to spare.
const MERCHANT_ROLE_SLUG = "merchant";

function isMerchantRole(slug) {
  return slug === MERCHANT_ROLE_SLUG;
}

// The Meister's terminal over the town's accounts (/treasury). A TAG, not the
// Meister ROLE — the same call the licence makes, and for the same reason: it is
// tradeable, so handing it over really does hand over the books, and a role
// check would quietly break that.
const MEISTERS_TERMINAL_SLUG = "meisters-terminal";

// Where the counter is — a LOCATION slug (docs/zones.yaml), one hop east of Customs via
// `connections:`. Buying and selling both require standing here, same as the Lifeweb requiring the Fortress.
const DEPOT_LOCATION_SLUG = "depot";

// The station imports ⬢ at RESOURCE_IMPORT_PRICE and pays RESOURCE_EXPORT_PRICE for them back, so the
// round trip always loses money — the spread can never be run in a loop to print obols (db/lib/syncTags.js
// enforces the same invariant for every priced tag).
const RESOURCE_IMPORT_PRICE = 2;
const RESOURCE_EXPORT_PRICE = 1;

// The id the ⬢ row carries on the Order and Price List tables. It was a sentinel when Resources weren't
// a Tag; they are one now, and this is that tag's slug — still not a cuid, so it never collides with a
// real ware's id, and a caller holding it has the slug it needs to find the stack.
const RESOURCE_WARE_ID = "resources";

// Sanity bound on a single line item — a fat-fingered quantity can't file for ten thousand vials.
const DEPOT_MAX_QUANTITY = 99;

// Coerce a client-supplied quantity into range; null for anything unusable, so callers reject rather than trade 1.
function normalizeQuantity(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > DEPOT_MAX_QUANTITY) return null;
  return n;
}

module.exports = {
  MERCHANT_LICENSE_SLUG,
  MEISTERS_TERMINAL_SLUG,
  MERCHANT_ROLE_SLUG,
  isMerchantRole,
  DEPOT_LOCATION_SLUG,
  DEPOT_MAX_QUANTITY,
  RESOURCE_IMPORT_PRICE,
  RESOURCE_EXPORT_PRICE,
  RESOURCE_WARE_ID,
  normalizeQuantity,
};
