import { zoneKey } from "@/lib/zones";

// The zone a row is in, as a chip — where the character is STANDING
// (Character.zoneId). It used to show the zone their faction was keyed to
// instead, so a Courtier read as Fortress wherever they had wandered; with
// factions gone there is one zone and the chip is simply it. Callers pass a
// flat `zoneName` string.
//
// No "use client": a leaf with no handlers, so it stays server-rendered inside
// the server components that draw it.
export default function ZoneChip({ zoneName }) {
  const key = zoneKey(zoneName);
  if (!zoneName) {
    return (
      <span className="chip zone-chip" data-zone="none">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No zone</span>
      </span>
    );
  }
  // A name we do not recognise still renders, just uncoloured — a renamed zone
  // should look unfamiliar, not disappear.
  return (
    <span className="chip zone-chip" data-zone={key ?? "none"}>
      {zoneName}
    </span>
  );
}
