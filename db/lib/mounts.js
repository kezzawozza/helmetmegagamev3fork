// Mount tags: buy an extra free zone crossing (db/lib/locationTravel.js) and set
// mount seats. Lives in db/ so both faces read one set; web/lib/tagRequests.js
// re-exports for page gates. See DEPOT.md §3 and CARRY.md §2.
// A mount only works while EQUIPPED (MOUNT slot, db/lib/equipSlots.js) and is
// unequipped at any indoors door — helpers here take ACTIVE slugs
// (`equippedSlugs` below), never a bare held-slug set.
const FAST_TRAVEL_SLUGS = new Set(["horse", "motorcycle", "arelitz-warbeast", "arelitz-thoroughbred"]);

// Horseshoes buy the plain Horse one more crossing — not the Thoroughbred/
// Warbeast (already fast, no shoe) and not the Motorcycle (no hooves).

// Tags that stop working once unequipped. The Ovum earns no free move (it
// hates moving, so it's not in FAST_TRAVEL_SLUGS) but still needs parking at
// an indoors door, so it's added here by hand.
const STOWABLE_SLUGS = new Set([...FAST_TRAVEL_SLUGS, "cart", "arelitz-ovum"]);

const HORSESHOE_SLUG = "horseshoes";

// Slugs a character currently has in play: held, minus any stowable not equipped.
function equippedSlugs(characterTags = []) {
  const active = new Set();
  for (const ct of characterTags) {
    const slug = ct?.tag?.slug;
    if (!slug) continue;
    if (STOWABLE_SLUGS.has(slug) && ct.equipped !== true) continue;
    active.add(slug);
  }
  return active;
}

// Seats a mount carries, rider included. Horse seats 2 (6 with Cart), Warbeast
// 4 (6 with Cart). Motorcycle is checked before Horse so the Cart upgrade can
// never reach it — a hand-cart towed behind a bike isn't a thing. Whichever
// mount is out decides the arithmetic when more than one is held.
function fastTravelCapacity(activeSlugs) {
  if (activeSlugs.has("arelitz-warbeast")) return activeSlugs.has("cart") ? 6 : 4;
  if (activeSlugs.has("arelitz-thoroughbred")) return activeSlugs.has("cart") ? 6 : 2;
  if (activeSlugs.has("horse")) return activeSlugs.has("cart") ? 6 : 2;
  if (activeSlugs.has("motorcycle")) return 2;
  return 0;
}

// Extra zone crossings a fast-travel mount buys. Every slug is worth 1 except
// the Thoroughbred (2). Horseshoes add one more, only under a plain Horse.
function fastTravelBonus(activeSlugs) {
  if (activeSlugs.has("arelitz-thoroughbred")) return 2;
  if (activeSlugs.has("horse")) return activeSlugs.has(HORSESHOE_SLUG) ? 2 : 1;
  return isMounted(activeSlugs) ? 1 : 0;
}

function isMounted(activeSlugs) {
  for (const slug of FAST_TRAVEL_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

// STOWABLE_SLUGS an indoors Location parks on arrival (db/lib/indoors.js),
// checked before the crossing so it refuses instead of spending the free
// move first (MAP.md §2c). Wider than isMounted: a bare Cart buys no free
// move but still won't fit where a horse can't.
function blocksOnFoot(activeSlugs) {
  for (const slug of STOWABLE_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

// Mounts held but not equipped, so Travel can warn before someone walks a
// day's road with a horse in their pocket. Returns display NAMES, not slugs —
// this goes straight into a sentence — falling back to slug only if unnamed.
function stowedMounts(characterTags = []) {
  return (characterTags ?? [])
    .filter((ct) => STOWABLE_SLUGS.has(ct?.tag?.slug) && ct.equipped !== true)
    .map((ct) => ct.tag.name ?? ct.tag.slug);
}

module.exports = {
  FAST_TRAVEL_SLUGS,
  STOWABLE_SLUGS,
  equippedSlugs,
  fastTravelCapacity,
  fastTravelBonus,
  isMounted,
  blocksOnFoot,
  stowedMounts,
};
