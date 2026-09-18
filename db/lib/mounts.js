// Mount tags: buy an extra free zone crossing (db/lib/locationTravel.js) and set
// mount seats. Lives in db/ so both faces read one set; web/lib/tagRequests.js
// re-exports for page gates. See DEPOT.md §3, CARRY.md §2 and ARELITZ.md.
// A mount only works while EQUIPPED (MOUNT slot, db/lib/equipSlots.js) and is
// unequipped at any indoors door — helpers here take ACTIVE slugs
// (`equippedSlugs` below), never a bare held-slug set.
//
// Arelitz replaced the old Horse/Warbeast/Ovum/Thoroughbred family
// (ARELITZ.md): one mount type instead of three bred variants, so this whole
// module collapses from per-variant branches to one `arelitz` slug.
// `unruly-arelitz` appears in NONE of the sets below — not being equippable
// is the entire "cannot be ridden" enforcement, so it needs no special case
// here at all.
const FAST_TRAVEL_SLUGS = new Set(["arelitz", "motorcycle"]);

// Tags that stop working once unequipped. Fishing Boat (and the whole
// water-travel/BOAT_CONFLICT concept it needed) is gone with the rest of
// Laboring's Fishing kind — upstream's own removal, confirmed no consumer
// anywhere in the tree references it any more.
const STOWABLE_SLUGS = new Set([...FAST_TRAVEL_SLUGS, "cart"]);

// Renamed from "horseshoes" — an arachnid does not wear shoes.
const ARELITZ_TACK_SLUG = "arelitz-tack";

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

// Seats a mount carries, rider included. An arelitz seats 2 (6 with Cart).
// Motorcycle is checked before Arelitz so the Cart upgrade can never reach
// it — a hand-cart towed behind a bike isn't a thing.
function fastTravelCapacity(activeSlugs) {
  if (activeSlugs.has("motorcycle")) return 2;
  if (activeSlugs.has("arelitz")) return activeSlugs.has("cart") ? 6 : 2;
  return 0;
}

// Extra zone crossings a fast-travel mount buys. An arelitz is worth 1, 2
// with Arelitz Tack.
function fastTravelBonus(activeSlugs) {
  if (activeSlugs.has("arelitz")) return activeSlugs.has(ARELITZ_TACK_SLUG) ? 2 : 1;
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
