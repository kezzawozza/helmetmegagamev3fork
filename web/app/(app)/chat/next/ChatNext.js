"use client";

import { useMemo } from "react";

// THE REBUILD'S SHELL (docs/systemdocs/CHAT-REBUILD.md, phase 1).
//
// This takes the SAME props object ../Chat.js does — page.js#FreshChat builds
// one serialisable thing and ChatView spreads it — so the server half, the
// snapshot machinery and both providers never learn that a second
// implementation exists. Swapping which component ChatView mounts is the whole
// cutover.
//
// Phase 1 is the shell and nothing under it: the five grid tracks, the two
// rails, and a girder at the head of each column. The places column fills in
// phase 2, the scene in 3, the composer in 4, the aside in 5. Each phase ends
// with something that runs, so this renders real place names today rather than
// placeholder copy — there is no new text anywhere in this file, and there
// should not be: every string a player reads already exists in ../Chat.js.
//
// `data-chat-next` on the root is what scopes chat-next.css. Nothing else sets
// it, so none of that stylesheet can reach the chat people actually use.
export default function ChatNext(props) {
  // The names are ../Chat.js's, verbatim — this component exists to be
  // swappable with it, so it reads the same object rather than a reshaped one.
  const { initialPlaces: places = [], initialPlace = null, self = null } = props;
  // ../Chat.js resolves this against the URL hash and a last-place memory; for
  // the shell, the server's own opening place is enough.
  const selectedKey = initialPlace ?? places[0]?.placeKey ?? null;

  // PHASE 2 OWES THIS COLUMN TWO ROWS IT DOES NOT HAVE YET. Bascinet's is not
  // in `initialPlaces` at all — ../Chat.js synthesises it client-side (:161)
  // because the DM is a pseudo-place with no seq and no archive (CHAT.md §2b),
  // and Deadchat arrives the same way. So the Mail run below is empty today and
  // the column renders one row short of the live one. That is the shell being
  // honest about what the server sent, not a grouping bug.

  // The grouping the places column draws, worked out here so phase 2 has a
  // shape to fill rather than a flat list to re-derive. Server order is
  // meaningful (zones sort), so this only buckets — it never sorts.
  const groups = useMemo(() => groupPlaces(places), [places]);

  const selected = places.find((p) => p.placeKey === selectedKey) ?? null;
  const here = selected?.name ?? null;

  return (
    <div className="chat-shell" data-chat-next>
      <div className="chat-body">
        <nav className="chat-places" aria-label="Places">
          <p className="bar">Places</p>
          {groups.map((group) => (
            <section key={group.key} className="chat-section">
              {group.zone ? <p className="zone-div">{group.zone}</p> : null}
              {group.runs.map((run) => (
                <div key={run.key}>
                  <p className="sect">{run.title}</p>
                  {run.places.map((place) => (
                    <button
                      type="button"
                      key={place.placeKey}
                      className="row-line"
                      data-active={place.placeKey === selectedKey ? "true" : undefined}
                      data-vantage={place.vantage ? "true" : undefined}
                    >
                      <span className="nm">{place.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </nav>

        {/* The rails are real grid tracks, not pseudo-elements pinned to a
            column's width — a flank can fold at a breakpoint without two more
            numbers keeping a rail in step. */}
        <div className="chat-rail" aria-hidden="true" />

        <div className="chat-centre">
          <p className="bar">
            {here}
            <span className="spacer" />
          </p>
          <div className="chat-feed" />
        </div>

        <div className="chat-rail" aria-hidden="true" />

        <aside className="chat-aside" aria-label="You">
          <p className="bar">You</p>
          {self?.name ? (
            <div className="plate">
              <div className="well">
                <p className="you-name">{self.name}</p>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// Mail and Radio first, then one group per zone in the order the server sent
// them, then anything with no zone at all. A zone divider is only drawn when
// there are two or more zones to divide — a living player stands in one zone
// and should see what they always saw; it is the GM and ghost seats, watching
// every zone at once, that had a flat run of every Location in the game.
function groupPlaces(places) {
  const run = (key, title, match) => {
    const found = places.filter(match);
    return found.length ? [{ key, title, places: found }] : [];
  };

  const groups = [];

  const mail = [
    ...run("dm", "Mail", (p) => p.kind === "dm"),
    ...run("dead", "Mail", (p) => p.kind === "dead"),
  ];
  if (mail.length) {
    groups.push({ key: "mail", zone: null, runs: [{ key: "mail", title: "Mail", places: mail.flatMap((r) => r.places) }] });
  }

  const radio = places.filter((p) => p.kind === "net" || p.kind === "party");
  if (radio.length) {
    groups.push({ key: "radio", zone: null, runs: [{ key: "radio", title: "Radio", places: radio }] });
  }

  // Server order, preserved: a Map keeps insertion order, and the places list
  // arrives already sorted by the zone sort the server applies.
  const byZone = new Map();
  for (const place of places) {
    if (!place.zoneId) continue;
    if (["dm", "dead", "net", "party"].includes(place.kind)) continue;
    if (!byZone.has(place.zoneId)) byZone.set(place.zoneId, { name: place.zoneName, places: [] });
    byZone.get(place.zoneId).places.push(place);
  }

  const manyZones = byZone.size > 1;
  for (const [zoneId, zone] of byZone) {
    const inZone = zone.places;
    const runs = [
      ...run(`${zoneId}-zone`, "Summary", (p) => inZone.includes(p) && p.kind === "zone"),
      // "Here" when a player stands in one; "Locations" for a seat watching
      // every zone at once.
      ...(() => {
        const locs = inZone.filter((p) => p.kind === "loc" && !p.vantage);
        return locs.length ? [{ key: `${zoneId}-loc`, title: locs.length > 1 ? "Locations" : "Here", places: locs }] : [];
      })(),
      ...run(`${zoneId}-room`, "Rooms", (p) => inZone.includes(p) && p.kind === "room" && !p.vantage),
      ...run(`${zoneId}-conv`, "Conversations", (p) => inZone.includes(p) && p.kind === "conv" && !p.vantage),
      ...run(`${zoneId}-vantage`, "Elsewhere", (p) => inZone.includes(p) && p.vantage),
    ];
    if (runs.length) groups.push({ key: zoneId, zone: manyZones ? zone.name : null, runs });
  }

  return groups;
}
