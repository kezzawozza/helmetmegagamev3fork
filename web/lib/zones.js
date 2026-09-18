// Zones as a colour vocabulary. "Underground" is absent — a category and a
// GM seat, never a place — so it has no chip to colour; its two levels, Caves
// and Depths, carry their own.
export const ZONE_KEYS = [
  "fortress",
  "town",
  "forest",
  "hills",
  "marshes",
  "caves",
  "depths",
];

// Zone NAMES that don't slugify to their own key. Both of these read as
// unrecognised without the alias.
const ZONE_KEY_ALIASES = {
  "black-hills": "hills",
  underground: "caves",
};

export function zoneKey(zoneName) {
  if (!zoneName) return null;
  const slug = String(zoneName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const key = ZONE_KEY_ALIASES[slug] ?? slug;
  return ZONE_KEYS.includes(key) ? key : null;
}

const CAVE_SEAT_KEY = "caves";
const CAVE_LEVEL_KEYS = ["caves", "depths"];

export function seatKey(zoneName) {
  const key = zoneKey(zoneName);
  return CAVE_LEVEL_KEYS.includes(key) ? CAVE_SEAT_KEY : key;
}

export function sortZones(zones) {
  return [...zones].sort((a, b) => {
    const ai = ZONE_KEYS.indexOf(zoneKey(a.name));
    const bi = ZONE_KEYS.indexOf(zoneKey(b.name));
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// `zoneName` — where the row's character is STANDING — is the whole test. It
// used to be either that or `factionZoneName`, the zone a character's faction
// was keyed to, and the seat outranked the feet on every desk. With factions
// gone there is no seat, so a GM's desk follows the feet: somebody who walks
// out of the Fortress and into Town moves onto the Town GM's list.
//
// A row with no zone at all stays visible to everyone — better seen twice than
// by nobody.
export function inVisibleZones(rows, visibleZoneNames) {
  if (!visibleZoneNames) return rows ?? [];
  const allowedNames = new Set(visibleZoneNames);
  const allowedSeats = new Set(visibleZoneNames.map(seatKey).filter(Boolean));
  const reaches = (zone) => {
    if (!zone) return false;
    if (allowedNames.has(zone)) return true;
    const seat = seatKey(zone);
    return Boolean(seat) && allowedSeats.has(seat);
  };
  return (rows ?? []).filter((r) => !r.zoneName || reaches(r.zoneName));
}
