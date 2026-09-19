"use client";

import { useCallback, useMemo } from "react";

import { DM_PLACE_KEY } from "../DmPane";
import { notableSeq } from "../feedStore";
import { useSeen, markAllSeen } from "../seenStore";
import { useNotified } from "../notifiedStore";
import { useOpenPlace, setOpenPlace } from "../openPlace";
import PlacesColumn from "./PlacesColumn";

// THE REBUILD'S SHELL (docs/systemdocs/CHAT-REBUILD.md).
//
// It takes the SAME props object ../Chat.js does — page.js#FreshChat builds one
// serialisable thing and ChatView spreads it — so the server half, the snapshot
// machinery and both providers never learn a second implementation exists.
// Swapping which component ChatView mounts is the whole cutover.
//
// It also reads the SAME stores. Those are transport, not presentation, and the
// rebuild keeps them: seen watermarks and notified counts are a durable
// localStorage contract shared across tabs, and reimplementing either would
// mean two browsers disagreeing about what you had read.
//
// Phase 2 draws the places column in full. The scene is phase 3, the composer
// 4, the aside 5. `data-chat-next` on the root is what scopes chat-next.css;
// nothing else sets it, so none of that stylesheet can reach the live chat.
export default function ChatNext(props) {
  // ../Chat.js's own prop names, verbatim — this exists to be swappable with it.
  const { initialPlaces: places = [], initialPlace = null, self = null } = props;

  const seen = useSeen();
  const notified = useNotified();
  const wanted = useOpenPlace();

  // Bascinet's row is not in `initialPlaces` and never will be: the DM is a
  // pseudo-place with no seq and no archive (CHAT.md §2b), so ../Chat.js
  // synthesises it client-side and this does the same. Deadchat, by contrast,
  // IS a real place and arrives with the rest.
  //
  // Phase 3 owes this the DM's own unread watermark, which lives in ../dmStore
  // and is a millisecond rather than a seq; until the pane exists there is
  // nothing to be unread of.
  const dmKey = self?.discordUserId ? DM_PLACE_KEY : null;
  const navPlaces = useMemo(() => {
    const out = [];
    if (dmKey) out.push({ placeKey: dmKey, name: "Bascinet", kind: "dm" });
    out.push(...places);
    return out;
  }, [places, dmKey]);

  const byKey = useMemo(() => new Map(navPlaces.map((p) => [p.placeKey, p])), [navPlaces]);
  // A remembered place since left falls back to the first, so a stale bookmark
  // opens the street rather than a blank column.
  const selectedKey =
    (wanted && byKey.has(wanted) ? wanted : null) ?? initialPlace ?? places[0]?.placeKey ?? null;
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;

  const onSelect = useCallback((placeKey) => setOpenPlace(placeKey), []);

  // What an unread mark compares against: the newest thing said here that was
  // ABOUT this viewer, not merely the newest thing said. A place used to light
  // for scenery — somebody lifting a stamp off a table — which is how an unread
  // mark stops meaning anything (feedStore.js#isNotableRow).
  //
  // The LARGER of two answers, never the first: the server's watermark covers
  // everything before this tab connected, the live one everything since, and
  // taking the tab's would hide a mention that landed while the page was shut.
  const selfCharacterId = self?.characterId ?? null;
  const selfSpeakerKey = self?.speakerKey ?? null;
  const newest = useCallback(
    (place) => {
      const live = notableSeq(place.placeKey, selfCharacterId, selfSpeakerKey);
      const seeded = place.notableSeq ?? null;
      if (live === null) return seeded;
      if (seeded === null) return live;
      return BigInt(live) > BigInt(seeded) ? live : seeded;
    },
    [selfCharacterId, selfSpeakerKey],
  );

  const onMarkAllSeen = useCallback(
    () => markAllSeen(navPlaces.map((place) => ({ placeKey: place.placeKey, seq: newest(place) }))),
    [navPlaces, newest],
  );

  return (
    <div className="chat-shell" data-chat-next>
      <div className="chat-body">
        <PlacesColumn
          places={navPlaces}
          selected={selectedKey}
          seen={seen}
          notified={notified}
          newest={newest}
          onSelect={onSelect}
          onMarkAllSeen={onMarkAllSeen}
        />

        {/* The rails are real grid tracks, not pseudo-elements pinned to a
            column's width — a flank can fold at a breakpoint without two more
            numbers keeping a rail in step. */}
        <div className="chat-rail" aria-hidden="true" />

        <div className="chat-centre">
          <p className="bar">
            {selected?.name ?? null}
            <span className="spacer" />
          </p>
          <div className="chat-feed" />
        </div>

        <div className="chat-rail" aria-hidden="true" />

        <aside className="chat-aside" aria-label="You">
          <p className="bar">You</p>
        </aside>
      </div>
    </div>
  );
}
