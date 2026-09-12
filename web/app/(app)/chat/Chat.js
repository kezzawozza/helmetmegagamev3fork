"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import EmptyState from "@/app/components/EmptyState";
import Modal from "@/app/components/Modal";
import ChatAside from "./ChatAside";
import MapBoard from "../map/MapBoard";
import PlacesColumn from "./PlacesColumn";
import useAsideFolded from "./useAsideFolded";
import useNarrow from "./useNarrow";
import useSwipeOpen from "./useSwipeOpen";
import { ICONS } from "@/app/components/NavRail";
import { SignOutIcon } from "@/app/components/icons";
import { signOutOfDiscord } from "@/app/actions";
import { describeTurn } from "@/lib/turnFormat";
import Feed from "./Feed";
import FactionPanel from "./FactionPanel";
import DmPane, { DM_PLACE_KEY } from "./DmPane";
import { useDmState, seedNewestOutbound, addDmRow, noteDmReconnect } from "./dmStore";
import NoticeCards from "./NoticeCards";
import GmAside from "./GmAside";
import { ConverseDialog } from "./PlacePanel";
import { addMember } from "./actions";
import { mentionsCharacter } from "@/app/components/richTokens";
import { playChime, chimedRecently } from "@/app/components/chime";
import useChatChimeMuted, { chatChimeMuted } from "@/app/components/useChatChimeMuted";
import { useSeen, markSeen, markAllSeen, seedSeenIfFresh, isUnread } from "./seenStore";
import { noteTyping } from "./typingStore";
import { usePushState, initPush, togglePush } from "./pushStore";
import { useOpenPlace, setOpenPlace } from "./openPlace";
import { useStreamState, noteStreamUp, noteStreamDown, noteStreamFatal } from "./streamStore";
import { useRefresh } from "@/app/components/useRefresh";
import {
  usePlaces,
  setPlaces,
  seedRows,
  seedInitial,
  applyRow,
  removeRow,
  notableSeq,
  markHistoryLoaded,
  markHistoryLoading,
  historyLoaded,
  isOwnRow,
  resetHistory,
} from "./feedStore";

// Chat: everywhere this character can hear, and one of them open.
//
// ONE EventSource for the whole tab, not one per place. Phase 0 opened a
// stream per place, which was fine when there was one; a Chat has a Location,
// its Rooms, the conversations you are in and the zone summary, and a browser
// allows six connections per origin. So `/api/feed?since=` carries every place
// the viewer may read and says which those are with its own `places` event —
// which is also how walking into somewhere new reaches an open page without a
// reload.

// Which place is open lives in ./openPlace.js — a module store the URL hash
// follows, rather than the hash itself. The hash used to be the truth, and
// the app router wrote over it on every refresh (see that file for the whole
// story); the store is read through useSyncExternalStore, never an effect.

// How many places a player's Chat warms in the background before it stops.
// See the prefetch effect for why there is a ceiling at all.
const PREFETCH_LIMIT = 12;

// The stream's own reconnect: a second after the first drop, doubling to half
// a minute, with a little jitter so a hundred tabs cut off by one redeploy do
// not all come back on the same tick.
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export default function Chat({
  initialPlaces,
  initialPlace,
  initialRows,
  initialSeq,
  self,
  aside,
  autocorrect = false,
  webOnly = false,
  // The people standing here, for the composer's @ list. The page hands the
  // same list to CharacterMentionsProvider, so what can be typed and what can
  // be rendered are one roster.
  roster = [],
  // A GM watching with no living character, and whether this character is
  // carrying an instant camera. Both only decide which controls a feed row
  // draws; the server re-decides every one of them when it is pressed.
  gm = false,
  // The GM's "Zones I see" picker, or null. It rides the right column rather
  // than the places list because it is a control, not a place — and because
  // that column is where the same picker sits on every GM desk.
  //
  // Only ever set in GM MODE, which is a GM with no living character
  // (web/lib/feedAccess.js#loadFeedViewer: `gm = isGm && !character`). A GM
  // who is playing somebody reads this page as that somebody, off the places
  // they are standing in — GmZoneView decides nothing there, so a picker
  // would be a control that changed nothing on the page carrying it. So this
  // is never handed to <ChatAside>: `aside` and `gmZones` cannot both exist.
  gmZones = null,
  hasCamera = false,
  // The composer's own two: the paperwork gates (web/lib/selfPools.js) and
  // whether there is anything over this character's face to put up or take
  // down. Both are hints — the four dialogs and toggleConceal re-check every
  // gate themselves.
  letters = null,
  conceal = null,
  // The faction this character is in, or null. A pseudo-place in the column
  // rather than a place: it has no channel, so what its row opens is a panel
  // (./FactionPanel.js), and the whole roster is decided on the server
  // (web/lib/selfPools.js#loadFactionView).
  faction = null,
  // The newest thing Bascinet said by DM, as epoch ms, for the Messages row's
  // dot before the pane has opened (./DmPane.js). The store takes over from
  // the first stream frame on.
  dmNewestMs = null,
  // The app's own nav, for the foot of the phone's places drawer. The bottom
  // bar is hidden on /chat under 720px so the scene has the whole screen
  // (globals.css), and these are the same rows it carried
  // (web/lib/navItems.js#loadNavItems, the list the rail itself draws).
  navItems = [],
}) {
  // The server's list is the first paint; the stream replaces it whole from
  // its first `places` event onward.
  const router = useRouter();
  const pathname = usePathname();
  const streamed = usePlaces();
  const places = streamed.length > 0 ? streamed : initialPlaces;
  const seen = useSeen();

  const wanted = useOpenPlace();
  const stream = useStreamState();

  // The faction's row. `faction:<id>` is a place key the archive will never
  // hold, which is exactly what makes it safe as a pseudo-key: it round-trips
  // through the hash like any other, and nothing that reads a feed can ever
  // match it.
  const factionKey = faction ? `faction:${faction.id}` : null;
  // And Bascinet's: the DM conversation, the same kind of pseudo-key (CHAT.md
  // §2b). Its "newest seq" is epoch ms — seenStore compares BigInt strings,
  // and epoch ms is one — so the dot works without seenStore knowing.
  const dmState = useDmState();
  // Gated on the ACCOUNT, not on a living character. The DM thread belongs to
  // the person, not the body — ./actions.js#gmThread says so and checks the
  // session alone — and a player whose character has died is exactly who most
  // needs to read what Bascinet said. This used to read self.characterId, so a
  // web-only player lost the whole conversation the moment they died.
  const dmKey = self?.discordUserId ? DM_PLACE_KEY : null;
  const dmNewest = dmState.newestOutboundMs === null ? null : String(dmState.newestOutboundMs);
  const navPlaces = useMemo(() => {
    const out = [];
    if (dmKey) out.push({ placeKey: dmKey, name: "Bascinet", kind: "dm", newestSeq: dmNewest, notableSeq: dmNewest });
    out.push(...places);
    if (factionKey) {
      out.push({ placeKey: factionKey, name: faction.name, kind: "faction", newestSeq: null, notableSeq: null });
    }
    return out;
  }, [places, factionKey, faction, dmKey, dmNewest]);
  const byKey = useMemo(() => new Map(navPlaces.map((place) => [place.placeKey, place])), [navPlaces]);
  // A remembered place you have since left falls back to the first place, so
  // a stale bookmark opens the street rather than a blank column.
  const selectedKey = (wanted && byKey.has(wanted) ? wanted : null) ?? initialPlace ?? places[0]?.placeKey ?? null;
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;
  const factionOpen = Boolean(factionKey && selectedKey === factionKey);
  const dmOpen = Boolean(dmKey && selectedKey === dmKey);
  // The silo is a Room, so the button only draws when that room is in this
  // character's own place list — a shut door keeps it out of the list, and a
  // button selecting a place they cannot read would be a dead end.
  const siloOpen = Boolean(faction?.silo && byKey.has(faction.silo.placeKey));

  const onSelect = useCallback((placeKey) => {
    setOpenPlace(placeKey);
  }, []);

  // What the unread dot compares against: the newest thing said in a place
  // that was ABOUT this viewer, not merely the newest thing said. A place used
  // to light up for scenery — somebody lifting a stamp off a table — which is
  // how an unread mark stops meaning anything (feedStore.js#isNotableRow).
  //
  // The LARGER of two answers, never the first of them. The server's watermark
  // covers everything said before this tab connected; the live one covers
  // everything since. Taking the tab's answer when it has one would hide a
  // mention that landed while the page was closed.
  const selfCharacterId = self?.characterId ?? null;
  // Their own hood, so a line they said under it is not news to them.
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

  const onSeen = useCallback((placeKey, seq) => markSeen(placeKey, seq), []);

  // The tick in the column's foot. Off the SAME `newest` every row's mark is
  // drawn from, so what it clears is exactly what was lit — a place whose
  // newest is null has nothing to mark and is skipped by markAllSeen.
  const onMarkAllSeen = useCallback(() => {
    markAllSeen(navPlaces.map((place) => ({ placeKey: place.placeKey, seq: newest(place) })));
  }, [navPlaces, newest]);

  // A browser opening Chat for the first time starts caught up rather
  // than with a dot beside everywhere it can hear. In a state INITIALIZER, so
  // it has run before the first client paint — from an effect it ran after
  // it, and every place flashed its unread dot for a frame on a first visit.
  // Not an effect and not a bare render-time write: the initializer is the
  // one place React runs a thing like this exactly once.
  useState(() => {
    if (typeof window === "undefined") return null;
    // The STORE first, and synchronously. Seeding it from an effect meant the
    // first client render drew an empty feed and the server's own rows landed
    // a frame later — "Nothing has been said here yet." flashing over a
    // scene that was already on the page. An initializer runs before that
    // first paint, and React runs it exactly once.
    // seedInitial rather than the three writes on their own: this runs during
    // a render, and that variant holds the store's notification for exactly
    // as long as it takes (feedStore.js#seedInitial).
    try {
      seedInitial({ places: initialPlaces, place: initialPlace, rows: initialRows });
    } catch {
      // The effect below repeats all three, so a store that refused here is
      // a frame of empty rather than an empty page.
    }
    try {
      seedNewestOutbound(dmNewestMs);
    } catch {
      // A missing seed costs a dot, nothing more.
    }
    try {
      seedSeenIfFresh([
        ...initialPlaces.map((entry) => ({ placeKey: entry.placeKey, seq: entry.newestSeq })),
        ...(dmNewestMs !== null && dmNewestMs !== undefined ? [{ placeKey: DM_PLACE_KEY, seq: String(dmNewestMs) }] : []),
      ]);
    } catch {
      // localStorage can be refused outright. A missing seed costs a dot,
      // nothing more.
    }
    return null;
  });

  const [chimeMuted, setChimeMuted] = useChatChimeMuted();

  // The two drawers, Discord's way round. Under 900px (useAsideFolded.js)
  // the right column has nowhere to stand, so it comes in from the right
  // over the scene — the same four panels, the same component. Under 720px
  // (useNarrow.js) the places column goes the same way, from the left. Both
  // are Modals, so Escape, the backdrop, the focus trap and the ✕ are the
  // shared dialog's rather than a drawer's own.
  const asideFolded = useAsideFolded();
  const narrow = useNarrow();
  // Whether the right column's drawer is open, under 900px where the column
  // itself has folded away. Both faces of the page use it — the player's
  // ChatAside and the GM's GmAside — since there is one drawer and only one of
  // the two is ever mounted in it.
  const [asideOpen, setAsideOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  // The noticeboard cards at the top of the Location's feed, and the counter
  // that makes them re-read. The Noticeboard dialog in the right column pins
  // to the SAME board, so the two have to share a signal or a pin leaves the
  // street showing the old papers.
  const [boardVersion, setBoardVersion] = useState(0);
  const bumpBoard = useCallback(() => setBoardVersion((n) => n + 1), []);
  // A search hit somebody clicked: which line, in which place, and when they
  // clicked it (so clicking the same hit twice scrolls twice).
  const [jump, setJump] = useState(null);
  // Bumped by the stream's `gap` event, after feedStore.resetHistory() has
  // marked every place idle: the selection effect and the prefetch below
  // hang off it, which is what makes them ask for the backlog again — the
  // store's history states are not something either of them subscribes to.
  const [gapNonce, setGapNonce] = useState(0);

  // ---- What the composer's slash commands reach for ------------------------
  //
  // `/travel` and `/converse` cannot be server actions: one picks a node in
  // the Travel grid and one opens a dialog, and both of those live in the
  // right column, which on a phone is not even mounted. Chat.js owns both
  // sides, so the callbacks are handed down to Feed.js and the state is
  // handed up to ChatAside.
  //
  //   travelPick   { locationId, at } — `at` is a timestamp so picking the
  //                same node twice re-opens the confirm strip.
  //   converseOn   whether the Converse dialog is open.
  //   placesVersion  bumped on every `places` frame, which is what a key
  //                turning or somebody else's /add looks like from here. The
  //                members strip re-reads on it.
  // Which place is open, for the stream handlers below. A ref rather than a
  // dependency: the EventSource is opened once per mount, and putting
  // `selectedKey` in that effect's deps would tear the connection down and
  // build it again every time somebody clicked a room.
  const selectedRef = useRef(null);
  const [travelPick, setTravelPick] = useState(null);
  const [converseOn, setConverseOn] = useState(false);
  const [placesVersion, setPlacesVersion] = useState(0);
  const bumpPlaces = useCallback(() => setPlacesVersion((n) => n + 1), []);

  // Web Push, asked once per tab. The store is what holds the answer — this
  // effect sets no state of its own (./pushStore.js).
  const push = usePushState();
  useEffect(() => {
    initPush();
  }, []);

  // Written in an effect, not during a render: react-hooks/immutability is an
  // error here and a ref written mid-render is exactly what it catches.
  useEffect(() => {
    selectedRef.current = selectedKey;
  }, [selectedKey]);

  // A line found by search. The window around it is loaded FIRST — the store
  // usually holds the newest hundred, and a hit from three days ago is not in
  // it — and only then is the place opened and the seq handed to Feed.js to
  // scroll to. Rows merge by seq, so a window that overlaps what is already
  // held costs nothing.
  const onJump = useCallback(
    (placeKey, seq) => {
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
    },
    [],
  );
  const openAside = useCallback(() => setAsideOpen(true), []);
  const closeAside = useCallback(() => setAsideOpen(false), []);
  const openPlaces = useCallback(() => setPlacesOpen(true), []);
  const closePlaces = useCallback(() => setPlacesOpen(false), []);
  // Picking a place from the drawer closes it: the place is what you came
  // for, and a drawer left over the scene you just chose is a second tap.
  const onSelectFromDrawer = useCallback((placeKey) => {
    setOpenPlace(placeKey);
    setPlacesOpen(false);
  }, []);
  // Swipe the scene right for the places, left for the people (Discord's
  // gestures). Only where the drawers exist — on a desktop the columns are
  // already on the page and a swipe means nothing.
  const centreRef = useRef(null);
  useSwipeOpen(centreRef, {
    onRight: narrow ? openPlaces : null,
    onLeft: aside && asideFolded ? openAside : null,
  });

  // The map, over the top of everything. Mounted HERE rather than in
  // ChatAside because Chat owns the one copy of it: ChatAside is written twice
  // below (the desktop column and the ⋯ sheet) and a Modal inside it would be
  // two declarations of the same overlay. Only one of the two ever mounts —
  // they are guarded on `asideFolded` — but the ownership is the point.
  //
  // On a folded viewport it navigates to /map instead of opening. A full-bleed
  // board inside the sheet would be a dialog inside a dialog on the smallest
  // screen there is, and /map is a real route precisely so the phone has
  // somewhere to go.
  const [mapOpen, setMapOpen] = useState(false);
  const openMap = useCallback(() => {
    setAsideOpen(false);
    if (asideFolded) router.push("/map");
    else setMapOpen(true);
  }, [asideFolded, router]);

  const onTravelPick = useCallback((locationId) => {
    setTravelPick({ locationId, at: Date.now() });
    // On a phone the grid is inside the right drawer, so picking a node from
    // the composer has to bring the drawer out with it — otherwise the
    // command answers "confirm it in Travel" and Travel is nowhere on screen.
    setAsideOpen(true);
  }, []);
  const onConverse = useCallback(() => setConverseOn(true), []);
  // "Add to …" on a person's row in HERE. The same server action the members
  // strip and the /add command use; the strip re-reads off placesVersion.
  // Answers with the action's own { ok, error }, so the list that offered the
  // row can say why nothing happened — a menu row that failed used to be
  // answered by the list not changing, and nothing else.
  const onAddMember = useCallback(
    (ref) => {
      if (!selectedKey || !ref) return Promise.resolve({ ok: false, error: "That place is gone." });
      return addMember(selectedKey, ref)
        .then((res) => {
          if (res?.ok) bumpPlaces();
          return res ?? { ok: false, error: "Something went wrong." };
        })
        .catch(() => ({ ok: false, error: "Could not reach the server. Nothing was changed." }));
    },
    [selectedKey, bumpPlaces],
  );

  // The seq the page was rendered at, captured ONCE. The stream below opens
  // from it and then keeps its own cursor; a later refresh hands this
  // component a newer initialSeq, and that one is deliberately ignored — the
  // stream that is already open has seen everything since. A state
  // initializer rather than a ref: a ref read during render is what
  // react-hooks/immutability catches, and this makes the stream effect's
  // dependency a stable value.
  const [mountSeq] = useState(() => initialSeq ?? "0");
  // Whether the stream has announced a place list yet. Once it has, the
  // server props stop seeding the list (the effect below): the stream's copy
  // is the newer one, and a refresh landing after a `places` frame must not
  // put the older list back. Written from the stream's handler only, never
  // during a render.
  const streamSpokeRef = useRef(false);
  const [refresh] = useRefresh();

  // The server render's rows and list, seeded again whenever they change.
  // All three already ran in the initializer above, before the first paint.
  // They are idempotent, and they stay here as the guard for the case the
  // initializer cannot cover: a refresh, or a client-side navigation back
  // onto this page, handing down newer props. The stream is NOT reopened
  // for that — it is the effect after this one, and it runs once per mount.
  useEffect(() => {
    seedRows(initialPlace, initialRows);
    if (!streamSpokeRef.current) setPlaces(initialPlaces);
    if (initialPlace) markHistoryLoaded(initialPlace);
  }, [initialPlace, initialPlaces, initialRows]);

  // One stream for the tab, opened once per mount and kept across every
  // refresh. `since` is the seq the page was rendered at, so the first
  // catch-up carries what happened while the page was loading and nothing
  // that was already in it; every reconnect after that asks from the newest
  // seq THIS stream has delivered, so it carries the gap and nothing else.
  //
  // The reconnect is the tab's own, not the browser's. An EventSource that
  // retries by itself replays the URL it was opened with — the page-load seq
  // — and the server's catch-up is capped, so after a long session a
  // browser-driven retry could never reach the rows it had actually missed.
  // So the `error` handler closes it and opens a new one from the cursor,
  // backing off from a second to half a minute; a tab coming back to the
  // front, or the network coming back, reopens at once.
  //
  // Why this used to jump the page: the stream was reopened on every refresh,
  // a reconnect re-announced the place list, and that announce refreshed the
  // page — which reopened the stream. Now a `places` frame refreshes the
  // right column only when the server says the character's own presence
  // moved (`reason: "presence"`), or when a reconnect finds the list changed
  // under it — never for a reconnect that found nothing new.
  useEffect(() => {
    let disposed = false;
    let source = null;
    let timer = null;
    // Consecutive failures, and how many connections have opened on this
    // mount. A drop says nothing about WHY — an EventSource reports no
    // status — so from the second failure on, the tab asks the plain places
    // route before trying again: a 401 there is a session that has expired,
    // and retrying that forever would only be noise in the server log; a 200
    // or no answer at all is the server or the network, and worth waiting for.
    let failures = 0;
    let opens = 0;
    let fatal = false;
    // Whether this streak of failures has been checked against the session
    // yet, and whether that check is out right now — `wake` must not open a
    // stream underneath it.
    let probed = false;
    let probing = false;
    // The newest seq this stream has DELIVERED — the same high-water mark the
    // server keeps for the connection. Not the store's newest: a history
    // fetch fills one place far past another's unread rows, and a summary row
    // can legitimately sit below every street row (the two wipe floors), so
    // the store's maximum is not a claim about every place at once. This is.
    let cursor = mountSeq;

    const noteSeq = (seq) => {
      try {
        if (BigInt(seq) > BigInt(cursor)) cursor = String(seq);
      } catch {
        // A seq that is not a number is not a cursor.
      }
    };

    // Is the session still good? Asked once per streak of failures, from the
    // second one on, and only its status is read — `?probe=1` answers off the
    // session alone (web/app/api/feed/places/route.js).
    const sessionGone = async () => {
      try {
        const res = await fetch("/api/feed/places?probe=1", { cache: "no-store" });
        return res.status === 401 || res.status === 403;
      } catch {
        return false;
      }
    };

    const schedule = () => {
      if (disposed || fatal || timer) return;
      const base = Math.min(RECONNECT_MIN_MS * 2 ** Math.max(0, failures - 1), RECONNECT_MAX_MS);
      const wait = base + Math.floor(Math.random() * RECONNECT_MIN_MS);
      timer = setTimeout(async () => {
        timer = null;
        if (failures >= 2 && !probed) {
          probed = true;
          probing = true;
          const gone = await sessionGone();
          probing = false;
          if (disposed) return;
          // A wake got there first and the stream is back up: nothing to do.
          if (source && source.readyState !== EventSource.CLOSED) return;
          if (gone) {
            fatal = true;
            noteStreamFatal();
            return;
          }
        }
        connect();
      }, wait);
    };

    // The tab is back in front, or the network is back: no reason to sit out
    // the rest of a backoff.
    const wake = () => {
      if (disposed || fatal || probing) return;
      if (document.visibilityState !== "visible") return;
      if (source && source.readyState !== EventSource.CLOSED) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      connect();
    };

    function connect() {
      if (disposed || fatal) return;
      source?.close();
      source = new EventSource(`/api/feed?since=${encodeURIComponent(cursor)}`);

      source.addEventListener("open", () => {
        failures = 0;
        probed = false;
        opens += 1;
        noteStreamUp();
        // The DM path has no seq to catch up from, so a reconnect tells the
        // pane to ask for its page again. The FIRST open is the page's own
        // load.
        if (opens > 1) noteDmReconnect();
      });
      source.addEventListener("error", () => {
        if (disposed) return;
        // Closed here rather than left to retry itself: the browser would
        // reuse the page-load cursor (see above).
        source?.close();
        failures += 1;
        noteStreamDown(failures);
        schedule();
      });
      source.addEventListener("message", (event) => {
        try {
          const row = JSON.parse(event.data);
          if (row?.seq) noteSeq(row.seq);
          applyRow(row.placeKey, row);
          // Somebody spoke in the conversation or private room that is OPEN.
          // A `places` frame only ever fires for the VIEWER's own presence, so
          // nothing else here tells them that a third party was let in or shown
          // out; the next thing anybody says is the cheapest honest prompt to
          // re-read the strip. Only for the two kinds of place that have one.
          const key = row.placeKey;
          if (
            key &&
            key === selectedRef.current &&
            (key.startsWith("conv:") || key.startsWith("room:"))
          ) {
            setPlacesVersion((n) => n + 1);
          }
          // Somebody said your name. The token is what the row is made of on
          // both faces (CHAT.md §5), so this rings for a Discord-origin mention
          // exactly as it does for a web one — and never for your own words.
          // mentionsCharacter knows both spellings of the token, so the chime
          // could not stop ringing when the grammar grew a name half.
          if (
            self?.characterId &&
            !isOwnRow(row, self.characterId, self.speakerKey) &&
            typeof row.content === "string" &&
            mentionsCharacter(row.content, self.characterId) &&
            !chatChimeMuted() &&
            !chimedRecently()
          ) {
            playChime(0.35);
          }
        } catch {
          // A malformed frame is not worth tearing the stream down over.
        }
      });
      // Somebody is writing something, here or on Discord. Held for six seconds
      // by typingStore.js and never sent for the viewer's own character.
      source.addEventListener("typing", (event) => {
        try {
          noteTyping(JSON.parse(event.data));
        } catch {
          // Same.
        }
      });
      // A delete carries only a seq and its place: the words somebody took back
      // never come back down the wire.
      source.addEventListener("delete", (event) => {
        try {
          const data = JSON.parse(event.data);
          removeRow(data?.placeKey, data?.seq);
        } catch {
          // Same.
        }
      });
      // Their feet moved, a key turned, or somebody let them into a
      // conversation — or a connection opened and said where they are. The
      // server has already resubscribed; this is the column catching up.
      source.addEventListener("places", (event) => {
        try {
          const data = JSON.parse(event.data);
          const changed = setPlaces(data?.places ?? []);
          streamSpokeRef.current = true;
          // The members strip re-reads on this: a key turning, or somebody
          // else's /add, is exactly what a places frame means — and after a
          // reconnect it is the one thing that can tell the strip who was
          // let into the open room while the tab was away.
          setPlacesVersion((n) => n + 1);
          // The right column is server props off page.js (where you are, who
          // is here, the Examine lines, the rooms a Transfer can reach), and
          // nothing else refreshes them, so a walk across town has to. Only
          // when the server says the VIEWER's own presence moved — that frame
          // fires for a web-only toggle too, which changes the column and not
          // the list — or when a reconnect found the list changed under it.
          // A reconnect that re-announces the same list refreshes nothing.
          // Through the shared transition, so the page never drops to its
          // loading skeleton for the length of the refetch (useRefresh.js).
          if (data?.reason === "presence" || (opens > 1 && changed)) refresh();
        } catch {
          // Same.
        }
      });
      // The reconnect's catch-up was too long to replay row by row
      // (web/app/api/feed/route.js). Every place is re-read from the history
      // route instead: the selection effect and the prefetch below do that
      // on their own once the store says nothing is loaded.
      source.addEventListener("gap", () => {
        resetHistory();
        setGapNonce((n) => n + 1);
      });
      // A DM for this account — Bascinet's turn result, a GM's reply, or the
      // line this tab just sent, coming back round (dmStore.js dedupes by id).
      // Rings the mention chime for something Bascinet said while the pane is
      // not the open place: a DM is always about you.
      source.addEventListener("dm", (event) => {
        try {
          const row = JSON.parse(event.data);
          // The hub's pg client came back from a drop (feedHub.js#resyncDm):
          // not a row, a prompt to fetch the page again.
          if (row?.resync) {
            noteDmReconnect();
            return;
          }
          addDmRow(row);
          // Quiet only while the pane is open AND somebody is looking at it.
          const reading = selectedRef.current === DM_PLACE_KEY && document.visibilityState === "visible";
          if (row?.direction === "OUTBOUND" && !reading && !chatChimeMuted() && !chimedRecently()) {
            playChime(0.35);
          }
        } catch {
          // Same.
        }
      });
    }

    connect();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      // `disposed` first: a StrictMode double-mount runs this cleanup and
      // then the effect again, and a timer left ticking from the first run
      // would open a second stream beside the second run's.
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [mountSeq, self?.characterId, self?.speakerKey, refresh]);

  // What was said BEFORE the page opened, for a place the reader has just
  // chosen. The stream only ever carries what happens next, so without this a
  // room opened for the first time would look empty until somebody spoke.
  useEffect(() => {
    // The two pseudo-places have no feed to load (./FactionPanel.js,
    // ./DmPane.js — the pane fetches its own page).
    if (!selectedKey || selectedKey.startsWith("faction:") || selectedKey === DM_PLACE_KEY || historyLoaded(selectedKey)) {
      return undefined;
    }
    // "loading" first, so Feed.js draws the skeleton instead of the empty
    // state while this is out. markHistoryLoading is also what stops a second
    // fetch: historyLoaded() is true for both of the non-idle states.
    markHistoryLoading(selectedKey);
    fetch(`/api/feed/history?place=${encodeURIComponent(selectedKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // NOT gated on `cancelled`. The rows are for a place, not for a
        // render, and the store is keyed by place — dropping them because the
        // reader had moved on left that place marked "loading" for the life of
        // the tab, so walking back into it drew the skeleton forever.
        if (data?.rows) seedRows(selectedKey, data.rows);
        markHistoryLoaded(selectedKey);
      })
      .catch(() => {
        // The stream still fills this place in as people speak. Marked loaded
        // either way, or the skeleton would sit there forever.
        markHistoryLoaded(selectedKey);
      });
    return undefined;
  }, [selectedKey, gapNonce]);

  // PREFETCH. After the first paint, every OTHER place's backlog is fetched
  // one at a time, so opening a room is instant rather than a skeleton and a
  // round trip. One at a time on purpose — a Chat has a Location, its rooms,
  // the conversations you are in and the summary, and firing six requests at
  // once would compete with the thing the reader is actually looking at.
  //
  // NOT FOR A GM. A player's list is a Location, its rooms, their
  // conversations and a summary — small enough to walk. A GM's list is every
  // zone, every Location and every Room they may watch, which is two hundred
  // and more, and each one of those is a `findMany` of a hundred rows plus an
  // avatar pass. Warming a Chat a GM will open one room of is a storm the
  // database pays for and nobody sees, so a GM fetches on selection like the
  // Chat always did. And even for a player it is CAPPED: a well-connected
  // character can sit in a lot of conversations, and past a dozen the warmth
  // is not worth the requests.
  useEffect(() => {
    if (gm) return undefined;
    let stopped = false;
    let timer = null;
    const queue = places
      .map((entry) => entry.placeKey)
      .filter(Boolean)
      .slice(0, PREFETCH_LIMIT);

    function step() {
      if (stopped) return;
      const next = queue.shift();
      if (!next) return;
      if (historyLoaded(next)) {
        timer = setTimeout(step, 0);
        return;
      }
      markHistoryLoading(next);
      fetch(`/api/feed/history?place=${encodeURIComponent(next)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          // Landed rows are stored whatever happened to the queue. `stopped`
          // only says "ask for no more" — reading it here left the place
          // stuck on "loading" and its feed showing the skeleton for good.
          if (data?.rows) seedRows(next, data.rows);
          markHistoryLoaded(next);
        })
        .catch(() => {
          markHistoryLoaded(next);
        })
        .finally(() => {
          if (!stopped) timer = setTimeout(step, 0);
        });
    }

    timer = setTimeout(step, 0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [places, gm, gapNonce]);

  // Which of the open place's doors a person can be let through. Only a
  // conversation and a PRIVATE room have one; everywhere else there is nothing
  // to add anybody to, and the row stays off the menu.
  const addPlace =
    selected && (selected.kind === "conv" || (selected.kind === "room" && selected.roomKind === "PRIVATE"))
      ? { placeKey: selected.placeKey, name: selected.name }
      : null;

  // Nowhere to stand is only a dead end if there is also nothing to read. A
  // dead character still has Bascinet's column.
  if (places.length === 0 && !dmKey) {
    return (
      <div className="chat-body chat-body--empty">
        <div className="panel">
          <EmptyState>You are nowhere yet.</EmptyState>
        </div>
      </div>
    );
  }

  // The places column, drawn ONCE: in the left column on a desktop, in the
  // ≡ drawer on a phone. The app's own links ride its foot on a phone, where
  // the bottom bar is gone from this page.
  //
  // The GM's zone picker used to ride here too, because the right column it
  // lived in was folded away and it had nowhere else to be. It has somewhere
  // else now: GmAside carries it, and GmAside follows the player's column into
  // the right drawer when it folds, so the picker goes with it rather than
  // turning up under a list of places it decides the contents of.
  const placesFoot =
    narrow && navItems.length > 0 ? (
      <div className="chat-places-nav">
        {narrow && navItems.length > 0 && (
          <nav className="chat-drawer-nav" aria-label="Main">
            {navItems.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="menu-item nav-sheet-item"
                  data-active={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "true" : "false"}
                >
                  {Icon && <Icon aria-hidden="true" />}
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <form action={signOutOfDiscord}>
              <button type="submit" className="menu-item nav-sheet-item" style={{ width: "100%" }}>
                <SignOutIcon aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </form>
          </nav>
        )}
      </div>
    ) : null;
  const placesColumn = (
    <PlacesColumn
      places={navPlaces}
      selected={selectedKey}
      seen={seen}
      newest={newest}
      onSelect={narrow ? onSelectFromDrawer : onSelect}
      webOnly={webOnly}
      chimeMuted={chimeMuted}
      onToggleChime={setChimeMuted}
      push={push.supported ? { on: push.on, busy: push.busy, onToggle: togglePush } : null}
      onMarkAllSeen={onMarkAllSeen}
      foot={placesFoot}
    />
  );

  // What the head's two phone buttons say: a dot on ≡ when some OTHER place
  // has something unread — the same test the column's rows draw their dot
  // from — and the count of people standing here on the people button.
  const unreadElsewhere = navPlaces.some(
    (place) => place.placeKey !== selectedKey && isUnread(seen, place.placeKey, newest(place)),
  );
  // Null in GM mode, and left that way: a GM's people list is fetched by the
  // column itself off whichever place is open, so this component genuinely
  // does not know the number. The button opens without a badge rather than
  // lifting that fetch up here to put one digit on it.
  const hereCount = aside ? (aside.people?.named?.length ?? 0) + (aside.people?.concealed?.length ?? 0) : null;
  const drawers = {
    onOpenPlaces: narrow ? openPlaces : null,
    // GM mode included. It had no right column to open before, so the button
    // was hidden and a GM on a phone had no way to reach one at all.
    onOpenAside: (aside || gmZones) && asideFolded ? openAside : null,
    unreadElsewhere,
    hereCount,
  };
  // The drawer's title is where the app header's turn chip went: the header
  // is hidden on a phone to give the scene its 60px back.
  // "Gamemaster" for GM mode, the way the header's chip says it (TurnMeta.js).
  const drawerTitle = [aside?.zone?.name ?? (gm ? "Gamemaster" : null), describeTurn(aside?.turn ?? null).label]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="chat-body">
      {!narrow && placesColumn}
      <div className="chat-centre" ref={centreRef}>
        {/* The live feed is down. Here rather than in the feed or the column
            foot: this row is on screen whichever pane is open, on a phone as
            well — and the phone is where a stream drops most, every time the
            screen locks. The first drop says nothing (streamStore.js). */}
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
        {factionOpen ? (
          <FactionPanel faction={faction} siloOpen={siloOpen} onSelect={onSelect} drawers={drawers} />
        ) : dmOpen ? (
          <DmPane self={self} drawers={drawers} />
        ) : (
        <Feed
          // Keyed on the place, so opening another room starts the composer
          // clean — a half-typed line, an edit in progress, a command chip
          // used to walk across with the reader and land in the wrong room.
          // The words themselves survive the switch (./draftStore.js).
          key={selectedKey}
          place={selected}
          // Where you are STANDING, which is not always what you are reading:
          // a conversation or the zone summary is open from somewhere. The
          // open place's own name is the heading under this, so anything that
          // would just repeat it is dropped rather than said twice.
          crumb={[aside?.zone?.name, aside?.place?.name].filter(
            (name) => name && name !== selected?.name,
          )}
          self={self}
          autocorrect={autocorrect}
          onSeen={onSeen}
          {...drawers}
          roster={roster}
          // whosHere() whole, hoods included — the slash commands' person
          // picker needs them, and `roster` above deliberately has none.
          people={aside?.people ?? null}
          onTravelPick={onTravelPick}
          onConverse={onConverse}
          placesVersion={placesVersion}
          gm={gm}
          hasCamera={hasCamera}
          letters={letters}
          canConceal={Boolean(conceal?.canConceal)}
          concealed={Boolean(conceal?.concealed)}
          alias={conceal?.alias ?? null}
          jump={jump}
          onJump={onJump}
          fallbackPlace={initialPlace}
          fallbackRows={initialRows}
          // Only in the STREET, and only where there is a board to read. A
          // room, a conversation and the zone summary have no noticeboard —
          // the board belongs to the Location (db/lib/noticeboard.js).
          notices={
            aside?.hasBoard && selected?.kind === "loc" ? (
              <NoticeCards version={boardVersion} onChanged={bumpBoard} />
            ) : null
          }
        />
        )}
      </div>
      {/* ONE of these ever mounts. The CSS hides the column under 900px, but
          hiding is not unmounting: both copies used to be live at once on a
          phone, which meant two travel loads, two stash reads and two
          separate answers about what can be worked here. */}
      {/* GM mode has no `aside` at all — page.js builds that off
          viewer.character, and GM mode is the absence of one — so the column
          is GmAside instead, which fetches what it needs off the place that is
          open rather than off a character (CHAT.md §9). Same tabs, same
          classes, same drawer below; a GM simply has no hands, so every panel
          in it is a readout. */}
      {!aside && gmZones && !asideFolded && (
        <aside className="chat-aside">
          <GmAside selected={selected} gmZones={gmZones} onPlaceChanged={bumpBoard} />
        </aside>
      )}
      {aside && !asideFolded && (
        <aside className="chat-aside">
          {/* The OPEN place, so the room panel knows which room's storage and
              fixtures to draw — the whole reason the Council Room's Intercom
              used to show up in the Kitchens. */}
          <ChatAside
            {...aside}
            selected={selected}
            onPlaceChanged={bumpBoard}
            travelPick={travelPick}
            addPlace={addPlace}
            onAddMember={onAddMember}
            onOpenMap={openMap}
          />
        </aside>
      )}
      {/* `/converse` from the composer. The SAME dialog the right column's
          Converse opens — and the reason it is mounted here rather than there
          is the phone, where the right column is not mounted at all. */}
      {aside && converseOn && (
        <ConverseDialog
          onClose={() => setConverseOn(false)}
          onDone={() => {
            setConverseOn(false);
            refresh();
          }}
        />
      )}
      {!aside && gmZones && asideFolded && asideOpen && (
        <Modal open title="Here" onClose={closeAside} panelClassName="modal-panel chat-drawer chat-drawer--right">
          <DrawerBody onSwipeClose={closeAside} side="right">
            <GmAside selected={selected} gmZones={gmZones} onPlaceChanged={bumpBoard} />
          </DrawerBody>
        </Modal>
      )}
      {aside && asideFolded && asideOpen && (
        <Modal open title="Here" onClose={closeAside} panelClassName="modal-panel chat-drawer chat-drawer--right">
          <DrawerBody onSwipeClose={closeAside} side="right">
            <ChatAside
              {...aside}
              selected={selected}
              onPlaceChanged={bumpBoard}
              travelPick={travelPick}
              addPlace={addPlace}
              onAddMember={onAddMember}
              onOpenMap={openMap}
            />
          </DrawerBody>
        </Modal>
      )}
      {narrow && placesOpen && (
        <Modal
          open
          title={drawerTitle || "Places"}
          onClose={closePlaces}
          panelClassName="modal-panel chat-drawer chat-drawer--left"
        >
          <DrawerBody onSwipeClose={closePlaces} side="left">
            {placesColumn}
          </DrawerBody>
        </Modal>
      )}
      {/* Escape and the backdrop both close it — Modal.js owns that, and its
          topmost-wins stack means Escape closes the map before the sheet
          underneath. "Return to game" inside the board is the same door,
          spelled out for anyone who does not reach for Escape. */}
      {mapOpen && (
        <Modal open title="Map" onClose={() => setMapOpen(false)} panelClassName="modal-panel map-panel">
          <MapBoard onClose={() => setMapOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

// The inside of a drawer: the same swipe that opened it, the other way,
// closes it. A wrapper rather than a ref on the Modal's panel because the
// Modal owns that ref.
function DrawerBody({ side, onSwipeClose, children }) {
  const ref = useRef(null);
  useSwipeOpen(ref, side === "left" ? { onLeft: onSwipeClose } : { onRight: onSwipeClose });
  return (
    <div ref={ref} className="chat-drawer-body">
      {children}
    </div>
  );
}
