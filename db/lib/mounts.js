// The mount tags — what buys a character an extra free zone crossing each turn
// (db/lib/locationTravel.js) and how many people the mount seats. Lives in db/
// so both faces read one set; web/lib/tagRequests.js re-exports it for the page
// gates. See DEPOT.md §3 and CARRY.md §2.
//
// A mount only works while it is EQUIPPED. That is the whole discouragement
// behind making Cart and Horse equippable: they take the MOUNT slot (a horse
// is ridden, a cart towed behind it — db/lib/equipSlots.js), and they are
// unequipped at the door of any indoors Location. So every helper here takes the slugs a
// character has ACTIVE, not merely the ones they hold — `equippedSlugs` below
// is what builds that set, and callers must not hand these functions a bare
// held-slug set by mistake.
const FAST_TRAVEL_SLUGS = new Set(["horse", "motorcycle", "arelitz-warbeast", "arelitz-thoroughbred"]);

// The boat is deliberately NOT a fast-travel mount. It buys the same extra
// crossing, but only between the three zones the water actually connects, and
// it does none of the other things that set does: no cancelling a ruined leg,
// no passing a mounted-only gate. Keeping it out of FAST_TRAVEL_SLUGS is what
// holds both of those true for free. It DOES carry passengers — see
// fastTravelCapacity below — that part isn't tied to FAST_TRAVEL_SLUGS at all.
const WATER_TRAVEL_SLUGS = new Set(["fishing-boat"]);

// Horseshoes buy the horse specifically one more crossing — not the
// Thoroughbred or Warbeast (already bred/built for speed, and neither wears a
// shoe the way a plain horse does) and not the Motorcycle (no hooves at all).

// Where a boat is any use. Zone SLUGS, not names — `hills` is the Black
// Hills.
const WATER_ZONE_SLUGS = new Set(["forest", "hills", "marshes"]);

// Tags that stop working the moment they leave your hands. Cart is here for
// its carry multiplier and its extra seats; the mounts and the boat for their
// free move. The Ovum earns no free move at all (it hates moving) so it is
// not in FAST_TRAVEL_SLUGS — but it is still an animal that needs parking at
// an indoors door, so it is added here by hand.
const STOWABLE_SLUGS = new Set([...FAST_TRAVEL_SLUGS, ...WATER_TRAVEL_SLUGS, "cart", "arelitz-ovum"]);

// A boat and a horse are the same slot in fiction — you are either riding or
// poling — so equipping one refuses while the other is out
// (web/app/(app)/character/equipActions.js).
const BOAT_CONFLICT_SLUGS = new Set([...FAST_TRAVEL_SLUGS, "cart"]);

const HORSESHOE_SLUG = "horseshoes";

// The slugs a character currently has in play: everything they hold, minus any
// stowable that is not equipped.
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

// Seats a mount carries, rider included. A horse alone seats 2; Cart upgrades
// that pair to 6, and that is the biggest ride there is. A Warbeast already
// seats 4 on its own, and 6 with a Cart — the same ceiling a horse reaches,
// just without needing the Cart to get there.
//
// The Motorcycle seats 2 and is checked BEFORE the horse, so the Cart upgrade
// below can never reach it: a hand-cart towed behind a motorcycle is not a
// thing, and leaving it to fall through would have quietly made one seat six.
// Somebody holding both a bike and a horse gets the horse's arithmetic, which
// is the only case where the order matters and is the generous reading. The
// Warbeast and Thoroughbred are checked in the same spot in that order, ahead
// of the horse, for the same reason: whichever mount a character has out
// decides the arithmetic, and this is the one place that has to pick.
function fastTravelCapacity(activeSlugs) {
  if (activeSlugs.has("arelitz-warbeast")) return activeSlugs.has("cart") ? 6 : 4;
  if (activeSlugs.has("arelitz-thoroughbred")) return activeSlugs.has("cart") ? 6 : 2;
  if (activeSlugs.has("horse")) return activeSlugs.has("cart") ? 6 : 2;
  if (activeSlugs.has("motorcycle")) return 2;
  if (activeSlugs.has("fishing-boat")) return 4;
  return 0;
}

// The extra zone crossings a fast-travel mount buys, on top of the base move
// every character gets. Every fast-travel slug is worth 1 except the
// Thoroughbred, which is bred for exactly this and is worth 2. Horseshoes add
// one more, but only under a plain Horse — see the slug's own comment above.
function fastTravelBonus(activeSlugs) {
  if (activeSlugs.has("arelitz-thoroughbred")) return 2;
  if (activeSlugs.has("horse")) return activeSlugs.has(HORSESHOE_SLUG) ? 2 : 1;
  return isMounted(activeSlugs) ? 1 : 0;
}

function isMounted(activeSlugs) {
  for (const slug of FAST_TRAVEL_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

function isBoated(activeSlugs) {
  for (const slug of WATER_TRAVEL_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

// Too big for an onFoot threshold — the same STOWABLE_SLUGS an indoors
// Location parks on arrival (db/lib/indoors.js), checked earlier so the
// crossing refuses instead of spending the free move before parking it
// (MAP.md §2c). Wider than isMounted: a bare Cart has no rider and buys no
// free move, but it's still a hand-cart that won't fit through a passage a
// horse can't either.
function blocksOnFoot(activeSlugs) {
  for (const slug of STOWABLE_SLUGS) if (activeSlugs.has(slug)) return true;
  return false;
}

// Whether a boat helps with THIS crossing. Both ends have to be on the water,
// so Forest -> Marshes is free and Forest -> Town is not. A caller that does
// not know the crossing (the sheet, which shows an allowance before anyone has
// picked a destination) passes nothing and gets false, which is the honest
// answer: the boat's extra move is not banked, it is earned per crossing.
function boatCrossing(fromZoneSlug, toZoneSlug) {
  if (!fromZoneSlug || !toZoneSlug) return false;
  return WATER_ZONE_SLUGS.has(fromZoneSlug) && WATER_ZONE_SLUGS.has(toZoneSlug);
}

// Holding a mount or a cart but not having it out. Travel asks so it can warn
// before someone walks a day's road with a horse in their pocket.
//
// Returns display NAMES, not slugs — this goes straight into a sentence a
// player reads, and "you're carrying a fishing-boat" is not a sentence.
// Falls back to the slug only if a caller passed rows without one.
function stowedMounts(characterTags = []) {
  return (characterTags ?? [])
    .filter((ct) => STOWABLE_SLUGS.has(ct?.tag?.slug) && ct.equipped !== true)
    .map((ct) => ct.tag.name ?? ct.tag.slug);
}

module.exports = {
  FAST_TRAVEL_SLUGS,
  WATER_TRAVEL_SLUGS,
  WATER_ZONE_SLUGS,
  BOAT_CONFLICT_SLUGS,
  STOWABLE_SLUGS,
  equippedSlugs,
  fastTravelCapacity,
  fastTravelBonus,
  isMounted,
  isBoated,
  blocksOnFoot,
  boatCrossing,
  stowedMounts,
};
