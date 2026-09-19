"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DM_PLACE_KEY } from "../DmPane";
import {
  usePlaces,
  notableSeq,
  seedInitial,
  seedRows,
  historyLoaded,
  markHistoryLoading,
  markHistoryLoaded,
} from "../feedStore";
import { useSeen, markAllSeen } from "../seenStore";
import { useRefresh } from "@/app/components/useRefresh";
import useFeedStream from "../useFeedStream";
import { useNotified } from "../notifiedStore";
import { useOpenPlace, setOpenPlace } from "../openPlace";
import PlacesColumn from "./PlacesColumn";
import Feed from "./Feed";
import Composer from "./Composer";
import ChatAside from "./ChatAside";
import GmAside from "./GmAside";
import DmPane from "./DmPane";

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
  const {
    initialPlaces: places = [],
    initialPlace = null,
    initialRows = [],
    self = null,
    gm = false,
    ghost = false,
    hasCamera = false,
    speakers = null,
    roster = [],
    // The right column's whole bag, built server-side in page.js. Null for a
    // GM with no living character — their column is GmAside's, phase 6.
    aside = null,
    // The GM's "Zones I see" picker. It rides the right column because it is a
    // control rather than a place, and because that is where the same picker
    // sits on every GM desk. Never set in the player seat, so `aside` and
    // `gmZones` can never both exist — which is what makes the two asides an
    // either/or below rather than a stack of both.
    gmZones = null,
  } = props;

  // Seed the store DURING render, not in an effect, and exactly once. The
  // first paint has to show the scene the server already sent — an effect
  // would paint one frame of empty first, and on a phone that frame is what a
  // reader sees every time they open the page. `react-hooks/set-state-in-effect`
  // is an error here for the same reason.
  // A useState initialiser rather than a ref poked during render: React runs
  // it exactly once per mount and `react-hooks/refs` refuses the ref version
  // outright. An EFFECT would be wrong for a different and worse reason — it
  // runs after the first paint, so the reader gets a frame of empty scene
  // every time they open the page.
  useState(() => {
    try {
      seedInitial({ places, place: initialPlace, rows: initialRows });
    } catch {
      // A store that refused costs a skeleton, nothing more.
    }
    return null;
  });

  // THE LIVE STREAM (../useFeedStream.js). The one thing the rebuild could
  // not carry until it was lifted out of ../Chat.js: 270 lines of EventSource
  // tangled into that file's layout, and the piece the plan marked "split
  // with care". It is the SAME hook the live chat runs — not a second copy —
  // so a reconnect fix lands on both faces at once.
  const selectedRef = useRef(null);
  const streamSpokeRef = useRef(false);
  const [refresh] = useRefresh();
  // The seq the page was rendered at, captured ONCE: the stream opens from it
  // and keeps its own cursor after that, so a later refresh handing down a
  // newer one is deliberately ignored.
  const [mountSeq] = useState(() => props.initialSeq ?? "0");
  const [gapNonce, setGapNonce] = useState(0);
  const [, setPlacesVersion] = useState(0);
  const bumpPlaces = useCallback(() => setPlacesVersion((n) => n + 1), []);
  const bumpGap = useCallback(() => setGapNonce((n) => n + 1), []);

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
  // The server's list is the first paint; the stream replaces it whole from
  // its first `places` frame on, and once it has spoken the server props stop
  // seeding — a refresh landing after that frame must not put the older list
  // back.
  const streamed = usePlaces();
  const live = streamed.length > 0 ? streamed : places;
  const navPlaces = useMemo(() => {
    const out = [];
    if (dmKey) out.push({ placeKey: dmKey, name: "Bascinet", kind: "dm" });
    out.push(...live);
    return out;
  }, [live, dmKey]);

  const byKey = useMemo(() => new Map(navPlaces.map((p) => [p.placeKey, p])), [navPlaces]);
  // A remembered place since left falls back to the first, so a stale bookmark
  // opens the street rather than a blank column.
  const selectedKey =
    (wanted && byKey.has(wanted) ? wanted : null) ?? initialPlace ?? places[0]?.placeKey ?? null;
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;


  const onSelect = useCallback((placeKey) => setOpenPlace(placeKey), []);
  // The pseudo-place takes the whole centre: it has no feed to scroll and no
  // composer that could ever say a line into a room (CHAT.md §2b).
  const isDm = selectedKey === DM_PLACE_KEY;

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

  // What was said BEFORE the page opened, for a place the reader has just
  // chosen. seedInitial covers the OPENING place only, and the stream carries
  // what happens next — so without this, walking into a room for the first
  // time draws an empty scene until somebody speaks.
  useEffect(() => {
    // The pseudo-place has no feed to load; DmPane fetches its own page.
    if (!selectedKey || selectedKey === DM_PLACE_KEY || historyLoaded(selectedKey)) return;
    // "loading" first, so the feed draws its skeleton rather than the empty
    // state while this is out. It is also what stops a second fetch:
    // historyLoaded() is true for both of the non-idle states.
    markHistoryLoading(selectedKey);
    fetch(`/api/feed/history?place=${encodeURIComponent(selectedKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // NOT gated on a cancelled flag. The rows belong to a PLACE, not to a
        // render, and the store is keyed by place — dropping them because the
        // reader moved on left that place marked "loading" for the life of the
        // tab, so walking back into it drew the skeleton forever.
        if (data?.rows) seedRows(selectedKey, data.rows);
        markHistoryLoaded(selectedKey);
      })
      .catch(() => {
        // Marked loaded either way, or the skeleton sits there forever.
        markHistoryLoaded(selectedKey);
      });
  }, [selectedKey, gapNonce]);

  // Kept in step for the stream's handlers, which read the open place without
  // being a dependency of the connection — putting it in the effect's deps
  // would tear the EventSource down on every click. Written in an EFFECT:
  // `react-hooks/refs` is an error here, and a ref poked mid-render is
  // exactly what it catches.
  useEffect(() => {
    selectedRef.current = selectedKey;
  }, [selectedKey]);

  useFeedStream({
    mountSeq,
    self,
    selectedRef,
    streamSpokeRef,
    refresh,
    bumpPlacesVersion: bumpPlaces,
    onGap: bumpGap,
  });

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
            {selected?.zoneName && <span className="crumb">{selected.zoneName}</span>}
            <span className="spacer" />
          </p>
          {isDm ? (
            <DmPane self={self} />
          ) : (
            <>
              <Feed
                place={selected}
            self={self}
            gm={gm}
            ghost={ghost}
            hasCamera={hasCamera}
            speakers={speakers}
                newAt={selected ? (seen?.get?.(selected.placeKey) ?? null) : null}
              />
              <Composer place={selected} self={self} gm={gm} roster={roster} />
            </>
          )}
        </div>

        <div className="chat-rail" aria-hidden="true" />

        {aside && (
          <aside className="chat-aside" aria-label="You">
            {/* The OPEN place, so the room block draws THIS room's storage and
                fixtures — the whole reason the Council Room's Intercom used to
                show up in the Kitchens. */}
            <ChatAside {...aside} selected={selected} />
          </aside>
        )}
        {!aside && gmZones && (
          <aside className="chat-aside" aria-label="This place">
            <GmAside selected={selected} gmZones={gmZones} />
          </aside>
        )}
      </div>
    </div>
  );
}
