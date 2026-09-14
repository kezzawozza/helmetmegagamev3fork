// The one way to turn a zone into the zone that OWNS it — the GM-seat key. Presence is six zones; GM seats/factions/stamped rows stay at four, the whole cave system belonging to the Caves seat. This helper is the single reader every writer goes through — never reach for zone.id when stamping a seat-scoped row, or a character acting on the Railroad files work no Caves GM can see.
function seatZoneIdFor(zone) {
  if (!zone) return null;
  return zone.seatZoneId ?? zone.parentZoneId ?? zone.id;
}

module.exports = { seatZoneIdFor };
