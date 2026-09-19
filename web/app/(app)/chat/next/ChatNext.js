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
import NoticeCards from "../NoticeCards";
import { SearchIcon } from "@/app/components/icons";
import IconButton from "@/app/components/IconButton";
import { retryPending } from "../feedStore";
import { useSeen, markAllSeen } from "../seenStore";
import { useRefresh } from "@/app/components/useRefresh";
import useFeedStream from "../useFeedStream";
import { useNotified } from "../notifiedStore";
import { useOpenPlace, setOpenPlace } from "../openPlace";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import MapBoard from "../../map/MapBoard";
import { ICONS, SignOutIcon } from "@/app/components/icons";
import { signOutOfDiscord } from "@/app/actions";
import { describeTurn } from "@/lib/turnFormat";
import { isUnread } from "../seenStore";
import { usePushState, initPush, togglePush } from "../pushStore";
import { useStreamState } from "../streamStore";
import ChatHead from "../ChatHead";
import useNarrow from "../useNarrow";
import useAsideFolded from "../useAsideFolded";
import useSwipeOpen from "../useSwipeOpen";
import { setChatViewAs } from "../actions";
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
    // A GM who also plays somebody: which seat this page is read from.
    viewAs = null,
    // The app's own nav, for the foot of the phone's places drawer. The
    // bottom bar is hidden on /chat under 720px so the scene has the whole
    // screen, and these are the rows it carried.
    navItems = [],
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
  const [placesVersion, setPlacesVersion] = useState(0);
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

  // ---- The phone --------------------------------------------------------
  //
  // Two drawers, Discord's way round. Under 900px the right column has
  // nowhere to stand, so it comes in from the right over the scene — the same
  // component, not a second one. Under 720px the places column goes the same
  // way, from the left. Both are Modals, so Escape, the backdrop, the focus
  // trap and the ✕ are the shared dialog's rather than a drawer's own.
  const narrow = useNarrow();
  const asideFolded = useAsideFolded();
  const [placesOpen, setPlacesOpen] = useState(false);
  const [asideOpen, setAsideOpen] = useState(false);
  const openPlaces = useCallback(() => setPlacesOpen(true), []);
  const closePlaces = useCallback(() => setPlacesOpen(false), []);
  const openAside = useCallback(() => setAsideOpen(true), []);
  const closeAside = useCallback(() => setAsideOpen(false), []);
  // Choosing from the drawer closes it: the tap was for the place, and a
  // drawer left over the scene you just chose is a second tap.
  const onSelectFromDrawer = useCallback((placeKey) => {
    setOpenPlace(placeKey);
    setPlacesOpen(false);
  }, []);
  // Swipe the scene right for the places, left for the people — Discord's
  // gestures. Only where the drawers exist: on a desktop both columns are
  // already on the page and a swipe would mean nothing.
  const centreRef = useRef(null);
  useSwipeOpen(centreRef, {
    onRight: narrow ? openPlaces : null,
    onLeft: aside && asideFolded ? openAside : null,
  });

  const pathname = usePathname();
  const router = useRouter();

  // The composer's send, reachable from the feed. A line the server refused
  // stays on screen marked unsent — losing what somebody typed is worse than
  // watching it sit there — and "Try again" re-sends it through the one send
  // path, slowmode hold and all.
  const sayRef = useRef(null);

  // Searching what was said. The BUTTON is on the head this component draws,
  // so the open flag is this component's; the box itself and the rule that
  // forces it back open on a hit that turned out to be gone are the feed's.
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // A hit somebody clicked. The window around the seq is loaded FIRST — the
  // store usually holds the newest hundred, and a hit from three days ago is
  // not in it — and only then is the place opened and the seq handed down to
  // scroll to. Rows merge by seq, so a window overlapping what is already
  // held costs nothing.
  const [jump, setJump] = useState(null);
  const onJump = useCallback((placeKey, seq) => {
    if (!placeKey || !seq) return;
    const go = () => {
      setJump({ placeKey, seq: String(seq), at: Date.now() });
      setOpenPlace(placeKey);
    };
    fetch(`/api/feed/history?place=${encodeURIComponent(placeKey)}&around=${encodeURIComponent(seq)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.rows) seedRows(placeKey, data.rows);
        markHistoryLoaded(placeKey);
        go();
      })
      // The place still opens. A hit whose window would not load is better
      // answered by the newest hundred than by nothing happening at all.
      .catch(go);
  }, []);

  // The noticeboard cards at the top of a street, and the counter that makes
  // them re-read. The aside's Noticeboard dialog pins to the SAME board, so
  // the two share a signal or a pin leaves the street showing the old papers.
  const [boardVersion, setBoardVersion] = useState(0);
  const bumpBoard = useCallback(() => setBoardVersion((n) => n + 1), []);
  const onRetry = useCallback(
    (clientId) => {
      if (!selectedKey) return;
      const row = retryPending(selectedKey, clientId);
      if (row) void sayRef.current?.(clientId, row.content);
    },
    [selectedKey],
  );

  // The map, over the top of everything, and owned HERE rather than in the
  // aside: the aside is placed twice below (the column and the drawer), and a
  // Modal inside it would be two declarations of the same overlay.
  //
  // On a folded viewport it NAVIGATES instead of opening. A full-bleed board
  // inside the drawer would be a dialog inside a dialog on the smallest
  // screen there is, and /map is a real route precisely so the phone has
  // somewhere to go.
  const [mapOpen, setMapOpen] = useState(false);
  const openMap = useCallback(() => {
    setAsideOpen(false);
    if (asideFolded) router.push("/map");
    else setMapOpen(true);
  }, [asideFolded, router]);

  // Switching seats is a RELOAD, not a re-render: the server decides the
  // whole page off the cookie this writes — which places exist, whether there
  // is an `aside` at all — so nothing short of asking again is honest.
  const onChangeViewAs = useCallback(
    (mode) => {
      if (!viewAs || mode === viewAs.mode) return;
      setChatViewAs(mode)
        .then((res) => {
          if (res?.ok) window.location.reload();
        })
        .catch(() => {});
    },
    [viewAs],
  );
  const push = usePushState();
  const stream = useStreamState();
  useEffect(() => {
    initPush();
  }, []);

  const onMarkAllSeen = useCallback(
    () => markAllSeen(navPlaces.map((place) => ({ placeKey: place.placeKey, seq: newest(place) }))),
    [navPlaces, newest],
  );

  // The app's links, at the foot of the phone's drawer. The GM's zone picker
  // does NOT ride here: it belongs to the right column, and that column has
  // its own drawer to fold into.
  const placesFoot =
    narrow && navItems.length > 0 ? (
      <nav className="chat-drawer-nav" aria-label="Main">
        {navItems.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              className="menu-item chat-drawer-item"
              data-active={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "true" : "false"}
            >
              {Icon && <Icon aria-hidden="true" />}
              <span>{item.label}</span>
            </Link>
          );
        })}
        <form action={signOutOfDiscord}>
          <button type="submit" className="menu-item chat-drawer-item">
            <SignOutIcon aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </form>
      </nav>
    ) : null;

  // Drawn ONCE and placed twice: the left column on a desktop, the ≡ drawer
  // on a phone. Never both — mounting two would be two of every fetch under
  // it.
  const placesColumn = (
    <PlacesColumn
      places={navPlaces}
      selected={selectedKey}
      seen={seen}
      notified={notified}
      newest={newest}
      onSelect={narrow ? onSelectFromDrawer : onSelect}
      viewAs={viewAs ? { mode: viewAs.mode, onChange: onChangeViewAs } : null}
      push={push.supported ? { on: push.on, busy: push.busy, onToggle: togglePush } : null}
      onMarkAllSeen={onMarkAllSeen}
      foot={placesFoot}
    />
  );

  // What the head's two phone buttons say: a dot on ≡ when some OTHER place
  // has something unread, and the count of people standing here on the other.
  const unreadElsewhere = navPlaces.some(
    (place) => place.placeKey !== selectedKey && isUnread(seen, place.placeKey, newest(place)),
  );
  // Null in the GM seat, deliberately: a GM's people list is fetched by the
  // right column off whichever place is open, so this component genuinely
  // does not know the number, and the button opens without a badge rather
  // than lifting that fetch up here for one digit.
  const hereCount = aside ? (aside.people?.named?.length ?? 0) + (aside.people?.concealed?.length ?? 0) : null;
  const drawers = {
    onOpenPlaces: narrow ? openPlaces : null,
    onOpenAside: (aside || gmZones) && asideFolded ? openAside : null,
    unreadElsewhere,
    hereCount,
  };
  // The drawer titles are where the app header's turn chip went: the header
  // is hidden on a phone to give the scene its 60px back.
  const placesTitle =
    [aside?.zone?.name ?? (gm ? "Gamemaster" : null), describeTurn(aside?.turn ?? null).label]
      .filter(Boolean)
      .join(" · ") || "Places";
  const worldPlace = selected && ["loc", "room", "zone"].includes(selected.kind);
  const asideTitle =
    [selected?.name, worldPlace && aside?.zone?.name !== selected?.name ? aside?.zone?.name : null]
      .filter(Boolean)
      .join(" · ") || "Here";
  const asidePane = aside ? (
    <ChatAside {...aside} selected={selected} onOpenMap={openMap} onPlaceChanged={bumpBoard} />
  ) : gmZones ? (
    <GmAside selected={selected} gmZones={gmZones} />
  ) : null;

  return (
    <div className="chat-shell" data-chat-next>
      <div className="chat-body">
        {!narrow && placesColumn}

        {/* The rails are real grid tracks, not pseudo-elements pinned to a
            column's width — a flank can fold at a breakpoint without two more
            numbers keeping a rail in step. Each is drawn only beside the
            column it borders, on the same condition that column mounts. */}
        {!narrow && <div className="chat-rail" aria-hidden="true" />}

        <div className="chat-centre" ref={centreRef}>
          <ChatHead
            name={selected?.name ?? null}
            crumb={[aside?.zone?.name, aside?.place?.name].filter((n) => n && n !== selected?.name)}
            {...drawers}
            trailing={
              <IconButton
                icon={SearchIcon}
                label="Search what was said"
                size={narrow ? "lg" : "sm"}
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen((was) => !was)}
              />
            }
          />
          {/* The stream is down. HERE rather than in the feed or a column
              foot: this row is on screen whichever pane is open, and the
              phone is where a connection drops most — every screen lock. The
              first drop says nothing (../streamStore.js). */}
          {stream === "retrying" && (
            <p className="chat-quiet-line" role="status">
              Reconnecting…
            </p>
          )}
          {stream === "fatal" && (
            <p className="chat-quiet-line" role="status">
              The connection dropped. Reload to catch up.
            </p>
          )}
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
                placesVersion={placesVersion}
                readOnly={Boolean(selected?.vantage)}
                onRetry={onRetry}
                searchOpen={searchOpen}
                onCloseSearch={closeSearch}
                jump={jump}
                onJump={onJump}
                // Only in the STREET, and only where there is a board to read:
                // a room, a conversation and the zone summary have none, and
                // a street you are only WATCHING is not one you can walk up
                // to and put your hands on (db/lib/vantages.js).
                notices={
                  aside?.hasBoard && selected?.kind === "loc" && !selected?.vantage ? (
                    <NoticeCards version={boardVersion} onChanged={bumpBoard} />
                  ) : null
                }
              />
              <Composer place={selected} self={self} gm={gm} roster={roster} sayRef={sayRef} />
            </>
          )}
        </div>

        {asidePane && !asideFolded && <div className="chat-rail" aria-hidden="true" />}

        {/* ONE of these ever mounts. The CSS hides the column under 900px,
            but hiding is not unmounting: two live copies meant two travel
            loads, two stash reads, and two separate answers about what can be
            worked here. The pane inside carries the OPEN place, so the room
            block draws THIS room's storage and fixtures — the whole reason
            the Council Room's Intercom used to show up in the Kitchens. */}
        {asidePane && !asideFolded && (
          <aside className="chat-aside" aria-label={aside ? "You" : "This place"}>
            {asidePane}
          </aside>
        )}
      </div>

      {narrow && placesOpen && (
        <Modal open title={placesTitle} onClose={closePlaces} panelClassName="modal-panel chat-drawer chat-drawer--left">
          <DrawerBody onSwipeClose={closePlaces} side="left">
            {placesColumn}
          </DrawerBody>
        </Modal>
      )}
      {asidePane && asideFolded && asideOpen && (
        <Modal open title={asideTitle} onClose={closeAside} panelClassName="modal-panel chat-drawer chat-drawer--right">
          <DrawerBody onSwipeClose={closeAside} side="right">
            {asidePane}
          </DrawerBody>
        </Modal>
      )}
      {mapOpen && (
        <Modal open title="Map" onClose={() => setMapOpen(false)} panelClassName="modal-panel map-panel">
          <MapBoard onClose={() => setMapOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

// A drawer closes the way it opened. The Modal already gives Escape, the
// backdrop and the ✕; this adds the gesture, in the direction that put it
// there.
function DrawerBody({ side, onSwipeClose, children }) {
  const ref = useRef(null);
  useSwipeOpen(ref, side === "left" ? { onLeft: onSwipeClose } : { onRight: onSwipeClose });
  return (
    <div ref={ref} className="chat-drawer-body">
      {children}
    </div>
  );
}
