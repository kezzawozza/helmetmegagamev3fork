"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import ChipLabel from "@/app/components/ChipLabel";
import { useTags } from "@/app/components/TagsProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { crossingConfirm, crossingLine, travelFoot, walkFoot, walkLine, openedByLabel, WALK_HINT } from "@/lib/travelCost";
import { loadMap } from "./actions";
import { travelTo } from "../chat/actions";

// The map. Every Location this character knows, drawn on the plate it was
// measured against, with the ways between them.
//
// One component, two hosts: the /map route and the overlay on /chat. Neither
// passes it anything except an optional onClose, because everything it draws
// comes from loadMap() — which is also where the fog lives. Nothing is hidden
// here that the server sent: an unknown Location never arrives in the first
// place.
//
// Travel is not re-implemented. Picking a reachable node opens the same
// confirm strip the Travel panel uses, reading the same numbers through
// travelFoot(), and Go calls the same travelTo action. There is one mover.

// Rhombus half-widths, in plate pixels. The plate is 2144 wide, so these are
// small on screen until you zoom — which is the point: the shape reads as a
// marker on a map rather than a button on a page.
//
// ONE SIZE for every node. They used to grow with what you knew — here bigger
// than stood, stood bigger than seen — which made a board of fifty read as
// though the big ones mattered more, when all the size meant was that you had
// been there. State is carried by the fill instead: a place you have only seen
// is the same rhombus, drawn hollow. What kept the old scale honest was Town,
// which packs seven Locations into a couple of hundred plate pixels; the
// smaller size here is what stops those colliding now.
//
// The ring sits well outside the core rather than hugging it, so the two read
// as a marker with a halo instead of one fat blob.
const RIM = 12.15;
const CORE = 8.1;
// The invisible square a finger actually aims at, half-width in plate pixels.
// 27, because the two closest Locations on the plate sit 54.6 apart (Keep and
// Lifeweb) and a hit area wider than half that gap turns a tap in the Fortress
// into a lottery about which of two places you meant. Touch only — see
// .map-node-hit, which leaves a mouse the rhombus it has always had.
const HIT = 27;
// What a comfortable target is, in CSS pixels, half-width. 22 -> a 44px box,
// the floor DESIGN-SYSTEM.md §9 sets for everything else you tap.
const HIT_PX = 22;
// The floor is 1, not something smaller, and that is the whole "no blank
// space" rule: at k=1 the plate exactly covers the window, so zooming out past
// it is zooming out past the world. Paired with preserveAspectRatio="slice"
// below, which CROPS the plate to fill the board rather than letterboxing it
// inside — "meet" left bars down the sides on any screen whose shape did not
// happen to match a 2144x1792 drawing.
const ZOOM = { min: 1, max: 7 };
const FIT_MAX = 2.1;

// How often the board checks whether somebody else moved you. The same
// interval CharacterPoller.js uses, for the same reason: a move is rare
// enough that this never competes with anything, and frequent enough that
// being dragged along does not read as the map having lost you.
const POLL_MS = 10_000;

// Whether Go is on offer for a node. THE one predicate the card's confirm strip
// reads, so a place can never offer Go while its own card is showing a refusal.
// Two ways to qualify now: next door and open, or somewhere farther in your own
// zone you could walk to through places you already know (MAP.md §3c).
function canTravelTo(node, here) {
  if (!node) return false;
  if (here && node.id === here.id) return false;
  if (node.adjacent && node.passable) return true;
  return Boolean(node.walkable);
}

// What a GESTURE may do, and it is deliberately LESS than what Go may do.
//
// Double-click moved somebody across a zone they had not chosen once already,
// and that is why it was taken out (MAP.md §6c). It is back under two limits
// that answer exactly that: never across a zone — so nothing a gesture does
// costs a travel, the Move, or anybody else's afternoon — and never down a road
// that would take your horse off you several hops from here, which is the one
// thing a walk does that cannot be undone for free. Everything else still wants
// the strip, the confirm and a deliberate press.
function canGestureTo(node, here) {
  if (!canTravelTo(node, here)) return false;
  return !node.crossesZone && !node.walkDismounts;
}

// A walk's numbers in the shape travelCost's walk helpers read.
function routeOf(node) {
  return {
    name: node.name,
    hops: node.walkHops ?? 0,
    through: node.walkThrough ?? [],
    dismounts: Boolean(node.walkDismounts),
    indoors: Boolean(node.indoors),
  };
}

export default function MapBoard({ onClose = null }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [sel, setSel] = useState(null);
  const [labels, setLabels] = useState(true);
  const [layer, setLayer] = useState(null);
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();
  // What the last move said — "that spent your Move", the Push on die. The
  // Travel panel hands its line to the chat; the board has nowhere else to
  // put it, so it goes on the card of the place you now stand.
  const [note, setNote] = useState(null);
  // useId() returns a string with punctuation React reserves (":r0:"), which
  // is legal in an id but not in a url(#…) reference. Stripped to word
  // characters so the mask resolves.
  const maskId = useId().replace(/[^a-zA-Z0-9]/g, "");

  const svgRef = useRef(null);
  const rootRef = useRef(null);
  // The plate's dimensions, read by applyView's clamp. A ref rather than a
  // dependency so applyView keeps a stable identity — it is in the deps of the
  // window pointer listeners, and re-subscribing those mid-drag drops the pan.
  const plateRef = useRef(null);
  // The pan/zoom transform lives in a ref and is written straight onto the
  // <g>, never through state: a pointermove that re-rendered fifty nodes and
  // eighty lines would drop frames on a phone, and nothing else on the page
  // needs to know where the view is.
  const view = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef(null);
  // Whether the gesture that just ended was a pan. `drag` is cleared on
  // pointerup and `click` fires after it, so a node's handler reading `drag`
  // would always see null and treat the end of a pan as a selection.
  const panned = useRef(false);
  // Every pointer currently down on the board, by id, in client pixels. A Map
  // rather than two slots because a third finger landing mid-pinch must not
  // corrupt the two that started it.
  const pointers = useRef(new Map());
  // The live pinch: how far apart the two fingers were and where their midpoint
  // sat, in plate pixels. Null whenever fewer than two are down.
  const pinch = useRef(null);
  // What kind of pointer last touched the board — "mouse", "touch" or "pen".
  //
  // This, and NOT a media query, is what makes the double-click a desktop
  // affordance. `(pointer: fine)` is true on a tablet with a mouse paired to it
  // while a FINGER is on the glass, which is precisely the case that got the
  // gesture removed the first time (MAP.md §6c): a tap landing on a node moved
  // somebody with no sentence in front of it. Asking the pointer that produced
  // the event cannot get that wrong. Same idiom as LedgerBand.js.
  const pointerKind = useRef(null);

  // How much of the plate the board can actually show, in plate pixels. With
  // "slice" the viewBox is scaled to COVER the element, so the visible window
  // is smaller than the plate in one axis and centred — which is what both the
  // pointer maths and the clamp have to agree about.
  const windowOf = useCallback((rect) => {
    const plate = plateRef.current;
    if (!plate?.width || !rect?.width) return null;
    const s = Math.max(rect.width / plate.width, rect.height / plate.height);
    return { s, w: rect.width / s, h: rect.height / s, W: plate.width, H: plate.height };
  }, []);

  // Everything that moves the view goes through here, which is why the clamp
  // lives here and not in the three callers: pan, zoom and fit cannot drift
  // apart about where the edge of the world is.
  //
  // The plate occupies [x, x + W*k] in viewBox units. Zoomed IN it must always
  // cover the box, so x is pinned between W - W*k and 0; zoomed OUT it is
  // smaller than the box and must stay inside it, so the interval is the same
  // two numbers the other way round. Taking the min and the max of the pair
  // handles both without a branch. Without this you could drag the whole map
  // off the edge and be left looking at an empty field with no way back but
  // Reset.
  const applyView = useCallback(() => {
    const win = windowOf(svgRef.current?.getBoundingClientRect());
    if (win) {
      const { k } = view.current;
      // The plate spans [x, x + W*k]; the window spans [(W-w)/2, (W+w)/2].
      // Covering it means x is at most the window's left edge and x + W*k at
      // least its right. At k >= 1 that interval always exists.
      const clamp = (v, seen, whole) => {
        const hi = (whole - seen) / 2;
        const lo = (whole + seen) / 2 - whole * k;
        return lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
      };
      view.current.x = clamp(view.current.x, win.w, win.W);
      view.current.y = clamp(view.current.y, win.h, win.H);
    }
    const { x, y, k } = view.current;
    rootRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
    // How big the touch target has to be drawn to come out 44px on the glass.
    // Written here rather than through state for the same reason the transform
    // is: it changes on every frame of a pan, and fifty nodes must not
    // re-render for it. HIT is already the widest a node may be without
    // reaching its neighbour, so this only ever shrinks it — which it does
    // once you are zoomed in far enough that a plate pixel is worth having.
    if (win) {
      const want = HIT_PX / (win.s * k * HIT);
      rootRef.current?.style.setProperty("--map-hit", String(Math.min(1, Math.max(0.5, want))));
    }
  }, [windowOf]);

  useEffect(() => {
    let cancelled = false;
    loadMap()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Couldn't read the map." });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Somebody else's feet can move YOU — a leader dragging a party along a
  // crossing, an escort — and unlike travelTo() below, that write happens on
  // a different browser entirely. This board has no other way to hear about
  // it: it is not fed by page.js (it fetches its own data so the standalone
  // /map route and the /chat overlay can share one component), so it is
  // outside the reach of the live feed's SSE "places" push that already
  // fires for every moved character (db/lib/presenceNotify.js) and refreshes
  // everything else on /chat. Without this, a passenger's board kept
  // describing the place they left until they closed and reopened it.
  //
  // /api/character-version, the same endpoint CharacterPoller.js polls for
  // the same reason, so this is a second reader rather than a new one.
  // Watches `locationId` alone, not the whole fingerprint: comparing the
  // opaque `fp` would also bump `nonce` — and with it re-frame the board via
  // the effect above — over something the map has nothing to do with, like a
  // resource spent or the turn advancing.
  const locationRef = useRef(undefined);
  useEffect(() => {
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch("/api/character-version", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const { locationId } = await res.json();
        if (locationRef.current === undefined) {
          locationRef.current = locationId;
          return;
        }
        if (locationId !== locationRef.current) {
          locationRef.current = locationId;
          setNonce((n) => n + 1);
        }
      } catch {
        // A timeout or a flaky network is a skipped tick, not an error.
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Before the framing effect below, which calls fit() -> applyView() and needs
  // the clamp to already know how big the world is. Effects run in declaration
  // order, so this is load-bearing placement rather than tidiness.
  useEffect(() => {
    plateRef.current = data?.plate ?? null;
  }, [data]);

  // Open on whichever layer the character is standing on — walking into the
  // caves switches you down, which is the only "navigation" this thing has.
  // Set during render rather than in an effect: react-hooks/set-state-in-effect
  // is an error in this repo, and this is the pattern React documents for
  // following a prop (TravelNodes.js does the same with its /travel pick).
  const [tookLayer, setTookLayer] = useState(null);
  if (data?.ok && data.you.layer && tookLayer !== nonce) {
    setTookLayer(nonce);
    setLayer(data.you.layer);
  }

  // ------------------------------------------------------------- pan / zoom

  // Plate pixels under the pointer, accounting for the letterboxing
  // preserveAspectRatio leaves around the viewBox.
  const toWorld = useCallback(
    (ev) => {
      const svg = svgRef.current;
      const plate = data?.plate;
      if (!svg || !plate?.width) return null;
      const b = svg.getBoundingClientRect();
      // max, not min: "slice" covers the box, so the plate overflows it rather
      // than sitting inside it, and the two offsets below go negative.
      const s = Math.max(b.width / plate.width, b.height / plate.height);
      const vx = (ev.clientX - b.left - (b.width - plate.width * s) / 2) / s;
      const vy = (ev.clientY - b.top - (b.height - plate.height * s) / 2) / s;
      const { x, y, k } = view.current;
      return { x: (vx - x) / k, y: (vy - y) / k, vx, vy };
    },
    [data?.plate],
  );

  // `to` defaults to `at`, so the wheel and the +/- buttons behave exactly as
  // they did: the plate point under the anchor stays under the anchor. A pinch
  // passes the OLD midpoint as `at` and the NEW one as `to`, and that one
  // difference is what makes two fingers pan and zoom in a single write — the
  // spot they grabbed stays between them. Panning survives the clamp on `k`,
  // too: at the floor of 1 the factor is swallowed and the translation is not.
  const zoomBy = useCallback(
    (factor, at = null, to = null) => {
      const plate = data?.plate;
      if (!plate?.width) return;
      const anchor = at ?? { vx: plate.width / 2, vy: plate.height / 2 };
      const land = to ?? anchor;
      const world = {
        x: (anchor.vx - view.current.x) / view.current.k,
        y: (anchor.vy - view.current.y) / view.current.k,
      };
      const k = Math.min(ZOOM.max, Math.max(ZOOM.min, view.current.k * factor));
      view.current = { k, x: land.vx - world.x * k, y: land.vy - world.y * k };
      applyView();
    },
    [applyView, data?.plate],
  );

  // The two fingers, measured: how far apart, and the plate pixel between them.
  // toWorld reads nothing off an event but clientX/clientY, so a bare pair of
  // numbers is a legal argument and there is no second conversion to keep in
  // step with the first.
  const gauge = useCallback(() => {
    if (pointers.current.size < 2) return null;
    const [a, b] = [...pointers.current.values()];
    const mid = toWorld({ clientX: (a.cx + b.cx) / 2, clientY: (a.cy + b.cy) / 2 });
    if (!mid) return null;
    // Never zero: two contacts reported on the same pixel would make the ratio
    // in onMove infinite and throw the view to ZOOM.max in one frame.
    return { d: Math.max(1, Math.hypot(a.cx - b.cx, a.cy - b.cy)), vx: mid.vx, vy: mid.vy };
  }, [toWorld]);

  // Frame whatever is currently drawn, rather than the whole plate. Early on a
  // character knows four Locations in one corner, and fitting the art would
  // leave them squinting at an empty ocean of it.
  const fit = useCallback(() => {
    const plate = data?.plate;
    const shown = (data?.nodes ?? []).filter((n) => onLayer(n, layer));
    if (!plate?.width || shown.length === 0) {
      view.current = { x: 0, y: 0, k: 1 };
      applyView();
      return;
    }
    // Padding in plate pixels around the known nodes. Generous, because the
    // floor is 1:1 now — anything that would have fitted at less than full
    // size is clamped up to it, and the frame just centres instead.
    const pad = 220;
    const xs = shown.map((n) => n.x);
    const ys = shown.map((n) => n.y);
    const w = Math.max(1, Math.max(...xs) - Math.min(...xs)) + pad * 2;
    const h = Math.max(1, Math.max(...ys) - Math.min(...ys)) + pad * 2;
    // Against the WINDOW, not the plate: with "slice" the board shows less of
    // the drawing than the drawing has, and fitting to the full plate would
    // frame a region partly off-screen.
    //
    // FIT_MAX, not ZOOM.max. Early on a character knows two Locations forty
    // pixels apart, and framing those alone would blow the plate up to seven
    // times size and put two enormous rhombi on an empty field. The ceiling
    // keeps the first look at the map looking like a map.
    const win = windowOf(svgRef.current?.getBoundingClientRect());
    const k = Math.min(
      FIT_MAX,
      Math.max(ZOOM.min, Math.min((win?.w ?? plate.width) / w, (win?.h ?? plate.height) / h)),
    );
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    view.current = { k, x: plate.width / 2 - cx * k, y: plate.height / 2 - cy * k };
    applyView();
  }, [applyView, data, layer, windowOf]);

  // Is anything drawn on `forLayer` inside the window the view is showing
  // right now? The window is the same interval applyView's clamp works in:
  // the plate spans [x, x + W*k] in viewBox units and the visible box sits
  // centred in it, so a node at plate (n.x, n.y) lands at x + n.x*k.
  const anythingInView = useCallback(
    (forLayer) => {
      const win = windowOf(svgRef.current?.getBoundingClientRect());
      const shown = (data?.nodes ?? []).filter((n) => onLayer(n, forLayer));
      if (!win || shown.length === 0) return false;
      const { x, y, k } = view.current;
      const left = (win.W - win.w) / 2;
      const top = (win.H - win.h) / 2;
      return shown.some((n) => {
        const px = x + n.x * k;
        const py = y + n.y * k;
        return px >= left && px <= left + win.w && py >= top && py <= top + win.h;
      });
    },
    [data, windowOf],
  );

  // Frame on arrival, and whenever the character's Location moves — the nonce
  // is that, and it is the only real navigation the board has.
  //
  // A layer press is deliberately NOT that. Surface and Underground are the
  // same plate drawn twice — one PLATE_SRC, one width and height, the flip is
  // a CSS treatment off data-layer — so { x, y, k } means the same thing on
  // both, and keeping it is what makes them read as two faces of one place
  // rather than two maps. It used to re-fit on every press, which threw you
  // somewhere else at a different zoom for no reason you asked for.
  //
  // The one exception is landing on nothing: if the spot you were looking at
  // holds nothing you know on the layer you just switched to, an empty field
  // is worse than a re-frame, so fit() runs after all. Reset is still there
  // for the rest.
  const framed = useRef(null);
  const flipped = useRef(null);
  useEffect(() => {
    if (!data?.ok) return;
    const key = `${nonce}:${layer}`;
    if (framed.current !== nonce) {
      framed.current = nonce;
      flipped.current = key;
      fit();
      return;
    }
    if (flipped.current === key) return;
    flipped.current = key;
    if (!anythingInView(layer)) fit();
  }, [data, layer, nonce, fit, anythingInView]);

  // The guard stays: a touch contact reports button 0, the second finger
  // included, so nothing here shuts pinch out — but a right-click must still
  // not start a pan.
  const onPointerDown = (ev) => {
    if (ev.button !== 0) return;
    const p = toWorld(ev);
    if (!p) return;
    pointers.current.set(ev.pointerId, { cx: ev.clientX, cy: ev.clientY });
    pointerKind.current = ev.pointerType;
    if (pointers.current.size === 1) {
      panned.current = false;
      drag.current = { vx: p.vx, vy: p.vy, x: view.current.x, y: view.current.y };
      return;
    }
    // A second finger ends the pan and starts a pinch. `panned` goes true and
    // stays true for the rest of the gesture: the click that fires when the
    // last finger lifts must never be read as picking a place.
    drag.current = null;
    panned.current = true;
    pinch.current = gauge();
  };

  // Tapping the plate itself puts the card away. Without this the only way to
  // unpick was a second tap on the very node you picked, which on a phone —
  // where the card is a sheet over the board — left the description sitting
  // over half the map with no obvious way to be rid of it.
  //
  // A node's own handler owns its clicks, so this stands aside for anything
  // inside one rather than racing it; the click bubbles up here afterwards and
  // would otherwise unpick whatever had just been picked. `panned` is the same
  // guard the nodes use: the end of a drag is not a tap.
  const onBoardClick = (ev) => {
    if (panned.current) return;
    if (ev.target?.closest?.(".map-node")) return;
    setSel(null);
  };

  // On the window rather than the SVG, and deliberately NOT via
  // setPointerCapture: capturing retargets the pointerup, and with it the
  // click, onto the <svg> — which would mean no node was ever clickable.
  // Listening on the window instead keeps a drag alive when the pointer
  // leaves the board and lets the click land where it was aimed.
  useEffect(() => {
    const onMove = (ev) => {
      // A fresh object rather than a mutated one: react-hooks/immutability is
      // an error in this repo, and one small allocation per move is nothing.
      if (pointers.current.has(ev.pointerId)) {
        pointers.current.set(ev.pointerId, { cx: ev.clientX, cy: ev.clientY });
      }
      if (pinch.current) {
        const g = gauge();
        if (!g) return;
        zoomBy(g.d / pinch.current.d, pinch.current, g);
        pinch.current = g;
        // Two fingers never fall through to the pan below, or the board would
        // be moved twice in one frame.
        return;
      }
      if (!drag.current) return;
      const p = toWorld(ev);
      if (!p) return;
      const dx = p.vx - drag.current.vx;
      const dy = p.vy - drag.current.vy;
      // A few pixels of slop, so a click with a shaky hand still selects a
      // node instead of being swallowed as a pan.
      if (Math.abs(dx) + Math.abs(dy) > 6) panned.current = true;
      view.current = { ...view.current, x: drag.current.x + dx, y: drag.current.y + dy };
      applyView();
    };
    const onUp = (ev) => {
      pointers.current.delete(ev.pointerId);
      if (pointers.current.size >= 2) {
        // Three fingers down to two. Re-measure rather than keep the old
        // distance, which belonged to a different pair and would jump the view
        // by the ratio between them.
        pinch.current = gauge();
        return;
      }
      pinch.current = null;
      if (pointers.current.size === 1) {
        // One finger left of two. The pan has to be re-seated on where THAT
        // finger actually is; leaving it on the midpoint would leap the map by
        // half the gap between the fingers the moment one lifted. `panned`
        // stays true, because this is still one gesture.
        const [only] = [...pointers.current.values()];
        const p = toWorld({ clientX: only.cx, clientY: only.cy });
        drag.current = p ? { vx: p.vx, vy: p.vy, x: view.current.x, y: view.current.y } : null;
        return;
      }
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyView, gauge, toWorld, zoomBy]);

  // Non-passive, because the page behind must not scroll while the map zooms.
  // React's onWheel is passive by default, so this is attached by hand.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    // Proportional to how far the wheel actually turned, not one fixed step per
    // event: a trackpad fires a stream of small deltas and a notched mouse
    // fires a few large ones, and a flat 1.15 per event made the first shoot
    // across the whole zoom range in a single flick. deltaMode is normalised
    // first (0 = pixels, 1 = lines, 2 = pages) because browsers disagree, and
    // the per-event factor is capped so one violent scroll cannot teleport.
    const onWheel = (ev) => {
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
      const factor = Math.exp(-ev.deltaY * unit * 0.0012);
      zoomBy(Math.min(1.2, Math.max(1 / 1.2, factor)), toWorld(ev));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toWorld, zoomBy]);

  // Travel, in one place. The card's Go is the only door onto it — travelTo,
  // which re-derives every gate server-side whatever the board thought
  // (MAP.md §6c). A zone crossing asks again on top of that, in the shared
  // confirm: it spends something, it carries whoever is with you, and it
  // cannot be walked back for free.
  //
  // Push on is the same door with a die in it (MAP.md §3): its own confirm,
  // then the same action with `exert` set.
  const go = async (node, { exert = false } = {}) => {
    if (node.crossesZone) {
      const asked = crossingConfirm(node, node.freeLeft ?? 0, data?.travel?.partySize ?? 0, { exert });
      if (!(await confirm(asked))) return;
    }
    setNote(null);
    run(travelTo, { locationId: node.id, exert }, {
      onOk: (res) => {
        setNote(res?.line ?? null);
        setSel(null);
        setNonce((n) => n + 1);
        router.refresh();
      },
    });
  };

  // Enter travels, once a place is picked — and only what a gesture may take
  // (canGestureTo), which is the same short list the double-click gets.
  //
  // A DOCUMENT listener rather than focusable rhombi, deliberately. Making
  // fifty SVG <g>s focusable would put fifty stops in the tab order in front of
  // Go, and role="button" on each would have a screen reader read the whole
  // plate as a toolbar — Tab-to-Go is better than both (MAP.md §6c). So the
  // shortcut only exists while something is picked, and it gets out of the way
  // of anything that legitimately wants the key: Go and Cancel, the layer
  // switch, and the confirm dialog this very handler can open.
  useEffect(() => {
    if (!sel || !data?.ok) return undefined;
    const onKey = (ev) => {
      if (ev.key !== "Enter" || ev.repeat) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      const el = document.activeElement;
      if (el && el !== document.body && el.closest("button, a, input, textarea, select, [role=dialog]")) return;
      // Same test the double-click makes: a board last touched by a finger has
      // no keyboard to press this with anyway, and asking keeps the two paths
      // honest about being one affordance.
      if (pointerKind.current !== "mouse") return;
      const nodes = data.nodes ?? [];
      const node = nodes.find((n) => n.id === sel);
      const standing = data.you?.locationId ? nodes.find((n) => n.id === data.you.locationId) : null;
      if (!canGestureTo(node, standing)) return;
      ev.preventDefault();
      go(node);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------- render

  if (!data) {
    return <div className="map-board map-board-quiet">Unrolling the map…</div>;
  }
  if (!data.ok) {
    return (
      <div className="map-board map-board-quiet">
        <FormError>{data.error}</FormError>
      </div>
    );
  }

  const { plate, nodes, edges, travel } = data;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const drawn = nodes.filter((n) => onLayer(n, layer));
  const drawnIds = new Set(drawn.map((n) => n.id));
  const here = data.you.locationId ? byId.get(data.you.locationId) : null;
  const chosen = sel ? byId.get(sel) : null;
  const card = chosen ?? here ?? null;
  const exits = nodes.filter((n) => n.adjacent);
  // Farther in this zone, nearest first. Its own list under its own heading: a
  // three-hop walk is not a way OUT of this room, and folding it into the grid
  // above would make the card lie about what is next door. On a phone, where
  // the card is a sheet over the board, this is the comfortable way to reach
  // one without hunting for a rhombus.
  const walks = nodes
    .filter((n) => n.walkable && !n.adjacent)
    .sort((x, y) => (x.walkHops ?? 0) - (y.walkHops ?? 0) || x.name.localeCompare(y.name));

  return (
    <div className="map-board">
      <div className="map-stage" data-layer={layer ?? "surface"}>
        <svg
          ref={svgRef}
          className="map-svg"
          data-layer={layer ?? "surface"}
          viewBox={`0 0 ${plate.width} ${plate.height}`}
          preserveAspectRatio="xMidYMid slice"
          role="presentation"
          onPointerDown={onPointerDown}
          onClick={onBoardClick}
        >
          <defs>
            {/* The water, cut out of the plate as an alpha mask so it can be
                painted with a token instead of the blue that was drawn into
                the art. See docs/assets/make-map-river.py. */}
            <mask id={`river-${maskId}`}>
              <image href="/assets/map-river.png" x="0" y="0" width={plate.width} height={plate.height} />
            </mask>
          </defs>

          <g ref={rootRef}>
            <image
              className="map-plate"
              href={plate.src}
              x="0"
              y="0"
              width={plate.width}
              height={plate.height}
            />
            <rect
              className="map-river"
              x="0"
              y="0"
              width={plate.width}
              height={plate.height}
              mask={`url(#river-${maskId})`}
            />

            <g className="map-edges">
              {edges.map((e) => {
                if (!drawnIds.has(e.a) || !drawnIds.has(e.b)) return null;
                const a = byId.get(e.a);
                const b = byId.get(e.b);
                return (
                  <line
                    key={`${e.a}-${e.b}`}
                    className="map-edge"
                    data-gate={e.gate ?? undefined}
                    data-opened={e.openedBy ? "true" : undefined}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                  />
                );
              })}
            </g>

            <g className="map-nodes">
              {drawn.map((n) => (
                <g
                  key={n.id}
                  className="map-node"
                  data-zone={n.zoneKey}
                  data-state={n.state}
                  data-reach={n.adjacent && n.passable ? "true" : undefined}
                  data-picked={sel === n.id ? "true" : undefined}
                  transform={`translate(${n.x} ${n.y})`}
                  onClick={() => {
                    if (panned.current) return;
                    if (sel !== n.id) {
                      setSel(n.id);
                      return;
                    }
                    // The second click unpicks, whatever the pointer and
                    // whatever the node. It used to be the Go button on a
                    // mouse, which meant a double-click — or, on the Travel
                    // panel, a tap that landed on the place already chosen —
                    // moved somebody with nothing in front of it. Go on the
                    // card is the only door now, and it is on screen the moment
                    // you pick, since the sheet opens. So this is just the way
                    // back out of a card sitting over the board, and there is
                    // The gesture below is a separate onDoubleClick and does
                    // not read `sel`, so this unpick cannot eat it.
                    setSel(null);
                  }}
                  onDoubleClick={() => {
                    // The gesture is back, and narrower than Go — see
                    // canGestureTo for the two limits and why they are the ones
                    // (MAP.md §6c).
                    //
                    // ORDER MATTERS HERE and is easy to get wrong: a browser
                    // fires click, click, dblclick — so the second click above
                    // has ALREADY set `sel` to null by the time this runs. A
                    // handler written as `if (sel === n.id)` would never once
                    // fire and would read as the feature simply not working.
                    // This acts on its own node and asks `sel` nothing.
                    if (panned.current) return;
                    if (pointerKind.current !== "mouse") return;
                    if (!canGestureTo(n, here)) return;
                    // Put the card back the second click took away, so they can
                    // see where they went.
                    setSel(n.id);
                    go(n);
                  }}
                >
                  {/* The thing a finger aims at. First, so it paints under the
                      marker; invisible, so the board is unchanged; inert on a
                      mouse, which does not need it (.map-node-hit). */}
                  <rect className="map-node-hit" x={-HIT} y={-HIT} width={HIT * 2} height={HIT * 2} />
                  <rect
                    className="map-node-rim"
                    x={-RIM}
                    y={-RIM}
                    width={RIM * 2}
                    height={RIM * 2}
                    transform="rotate(45)"
                  />
                  <rect
                    className="map-node-core"
                    x={-CORE}
                    y={-CORE}
                    width={CORE * 2}
                    height={CORE * 2}
                    transform="rotate(45)"
                  />
                  {labels && (
                    <text className="map-node-label" y={RIM + 30} textAnchor="middle">
                      {n.name}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </g>
        </svg>

        {/* The two HUD blocks in one wrapper. It is display: contents on a
            desktop, so each keeps the corner it has always had; on a phone it
            becomes a column, which is the only way neither has to know how
            wide the other is — side by side they need 486px of a 390px
            screen and the layer switch ended up behind the zoom buttons. */}
        <div className="map-hud">
          {/* Only once the character knows somewhere underground. Offering the
              switch before that would tell them a second layer exists, which is
              exactly the kind of thing the fog is for. */}
          {data.layers.length > 1 && (
            <div className="map-layers segmented">
              <button
                type="button"
                aria-pressed={layer === "surface"}
                onClick={() => {
                  setLayer("surface");
                  setSel(null);
                }}
              >
                Surface
              </button>
              <button
                type="button"
                aria-pressed={layer === "under"}
                onClick={() => {
                  setLayer("under");
                  setSel(null);
                }}
              >
                Underground
              </button>
            </div>
          )}

          <div className="map-controls">
            <button type="button" className="btn-quiet" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
              −
            </button>
            <button type="button" className="btn-quiet" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
              +
            </button>
            <button type="button" className="btn-quiet" onClick={fit}>
              Reset
            </button>
            <button
              type="button"
              className="chip"
              data-active={labels ? "true" : undefined}
              aria-pressed={labels}
              onClick={() => setLabels((on) => !on)}
            >
              Names
            </button>
            <span className="map-count mono">
              {data.known} of {data.total}
            </span>
          </div>
        </div>
      </div>

      {/* data-picked is the whole phone layout: under 640px the card is a
          sheet over the board, and this is what decides whether it is a strip
          of Ways out or open far enough to show Go. No state of its own —
          `chosen` already knows. */}
      <aside className="map-card panel" data-picked={chosen ? "true" : undefined}>
        {card ? (
          <MapCard
            node={card}
            here={here}
            travel={travel}
            pending={pending}
            error={error}
            note={note}
            onCancel={() => setSel(null)}
            onGo={() => go(card)}
            onExert={() => go(card, { exert: true })}
          />
        ) : (
          <EmptyState>You aren&apos;t on the map yet.</EmptyState>
        )}

        {!chosen && exits.length > 0 && (
          <div className="map-exits">
            <p className="chat-section-title">Ways out</p>
            {exits.map((n) => (
              <button key={n.id} type="button" className="map-exit" onClick={() => setSel(n.id)}>
                <span>{n.name}</span>
                {/* The tag of theirs that opens it, where one does — the same
                    chip the Travel panel and the card below draw. */}
                <ViaChip slug={n.openedBy} />
                <span className="mono">{travelFoot(n, n.freeLeft ?? 0, travel?.mounted, travel?.moved)}</span>
              </button>
            ))}
          </div>
        )}

        {!chosen && walks.length > 0 && (
          <div className="map-exits">
            <p className="chat-section-title">Further in {here?.zoneName ?? "this zone"}</p>
            {walks.map((n) => (
              <button key={n.id} type="button" className="map-exit" onClick={() => setSel(n.id)}>
                <span>{n.name}</span>
                <span className="mono">{walkFoot(routeOf(n), travel?.mounted)}</span>
              </button>
            ))}
          </div>
        )}

        {onClose && (
          <button type="button" className="btn-quiet map-return" onClick={onClose}>
            Return to game
          </button>
        )}
      </aside>
    </div>
  );
}

// Customs is a Caves Location whose building is drawn on the surface plate, so
// it stands on both layers — it is the threshold, and hiding it from the
// surface would make the way underground start nowhere.
function onLayer(node, layer) {
  if (!layer) return node.layer === "surface" || node.both;
  return node.both || node.layer === layer;
}

function Inside({ inside }) {
  const groups = [
    { key: "public", label: "Rooms", items: inside.public },
    { key: "private", label: "Private rooms", items: inside.private },
    { key: "conversations", label: "Conversations", items: inside.conversations },
  ].filter((group) => group.items?.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="map-inside">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="chat-section-title">{group.label}</p>
          <ul className="map-inside-list">
            {group.items.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// The trait chip, resolved from a slug. Both places on this page that draw one
// want the identical thing, and neither has anywhere to put the sentence, so
// the name is on the chip and the sentence is on its title. `tagsBySlug` is the
// root layout's streamed catalog plus everything this character holds — and
// openedBy is only ever a tag they hold, so the lookup cannot come up empty.
// ChipLabel, not TagChip: both call sites are inside a <button>.
function ViaChip({ slug }) {
  const { tagsBySlug } = useTags();
  const tag = slug ? (tagsBySlug.get(slug) ?? null) : null;
  if (!tag) return null;
  return (
    <span className="map-via" title={openedByLabel(tag.name)}>
      <ChipLabel tag={tag} />
    </span>
  );
}

function MapCard({ node, here, travel, pending, error, note, onCancel, onGo, onExert }) {
  const isHere = here && node.id === here.id;
  const reachable = canTravelTo(node, here);
  // Farther in this zone rather than next door — a walk of several hops. Note
  // this is on the CARD, so it reaches every device: clicking a place you are
  // not beside and pressing Go is the ordinary way to do this on a phone. The
  // double-click is only a shortcut for a mouse on top of it.
  const walking = !isHere && Boolean(node.walkable) && !node.adjacent;
  // Whether the double-click / Enter shortcut applies to this node at all.
  const gestural = canGestureTo(node, here);
  // node's OWN count, not the header's ambient one — a boat's bonus is
  // earned per crossing, so a water-eligible destination can still be free
  // even when the header's pre-selection number already reads 0.
  const nextTurn = Boolean(node.crossesZone && (node.freeLeft ?? 0) <= 0);

  return (
    <div className="map-card-body">
      <p className="map-card-name">{node.name}</p>
      <div className="chip-row">
        <span className="chip zone-chip" data-zone={node.zoneKey}>
          {node.zoneName}
        </span>
        {/* Beside the zone rather than under it: both answer "what is this
            place to me", and the shared .chip-row is what a line of chips is
            already spelled as everywhere else. */}
        <ViaChip slug={node.openedBy} />
      </div>

      {node.description && <p className="text-sm">{node.description}</p>}

      {isHere && <p className="chat-quiet-line">You are standing here.</p>}
      {isHere && note && <p className="text-sm">{note}</p>}
      {!isHere && node.state === "seen" && (
        <p className="chat-quiet-line">You have not been here.</p>
      )}

      {/* What is inside, for a place they have actually stood in. Three lists
          rather than one: a public room is somewhere anyone may walk, a
          private one is a door they hold the key to, and a conversation is
          people rather than architecture. The server sends only the private
          rooms this character may enter, so there is nothing to filter here —
          and nothing to leak by forgetting to. */}
      {node.inside && <Inside inside={node.inside} />}

      {/* Held where they stand (INTERCEPT.md). It deliberately does not swallow
          the block below: the server shuts every way and writes the reason
          onto each row, so a node falls into the refusal branch on its own and
          the board stays readable while somebody has hold of you. */}
      {travel?.held ? <p className="text-sm">{travel.held}</p> : null}

      {!isHere && (node.adjacent || node.walkable) && (
        <div className="map-confirm">
          {reachable ? (
            <>
              {/* A walk says how far and names the stops; a single hop says what
                  the crossing costs. Both sentences come from travelCost.js, so
                  this card and the Travel panel cannot word them differently. */}
              <p className="text-sm">
                {walking ? walkLine(routeOf(node)) : crossingLine(node, nextTurn, travel?.moved)}
              </p>
              {travel?.partySize > 0 && (
                <p className="chat-quiet-line">
                  {travel.partySize === 1 ? "One person" : `${travel.partySize} people`} with you.
                </p>
              )}
              <FormError>{error}</FormError>
              <div className="chat-buttons">
                {/* Same rule as the Travel panel: Go is the Move, and once
                    that is spent a crossing with no travel left has none to
                    offer, so the button leaves (MAP.md §3). */}
                {!(nextTurn && travel?.moved) && (
                  <button type="button" className="btn" disabled={pending} onClick={onGo}>
                    Go
                  </button>
                )}
                {/* Same button the Travel panel draws, for the same reason. */}
                {nextTurn && node.canExert && (
                  <button
                    type="button"
                    className="btn"
                    disabled={pending}
                    title="Exert yourself for another free travel."
                    onClick={onExert}
                  >
                    Push on
                  </button>
                )}
                <button type="button" className="btn-quiet" disabled={pending} onClick={onCancel}>
                  Cancel
                </button>
              </div>
              {/* Only where a gesture would actually be taken, and only for a
                  mouse — .map-hint is hidden outright on a coarse pointer, so a
                  phone is never told about a shortcut it does not have. */}
              {gestural && <p className="chat-quiet-line map-hint">{WALK_HINT}</p>}
            </>
          ) : (
            // Straight off crossingCheck, which already carries its own mark.
            <p className="text-sm">{node.reason}</p>
          )}
        </div>
      )}
    </div>
  );
}
