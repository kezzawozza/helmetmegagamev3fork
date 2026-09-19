"use client";

import { useCallback, useSyncExternalStore } from "react";

// WHICH SECTIONS OF THE PLACES COLUMN THIS BROWSER HAS SHUT, and unlike the
// column this replaces, it remembers across a reload.
//
// It was session-only (a plain useState in ../PlacesColumn.js) and the comment
// above it said why: folding used to break the column, because `.bar` took a
// flex shorthand that set flex-grow: 1, and the one growing item in a flex
// column swallowed whatever free space appeared once the list stopped
// overflowing. That is fixed at the CSS root now — `.bar` pins `flex: 0 0 auto`
// longhand in chat-next.css — and the old comment says as much itself. So the
// reason for forgetting is gone, and a column that forgets what you shut every
// time you reload is just a column that does not work.
//
// Shaped on ../asideTabStore.js, which already solves the hard parts of reading
// localStorage in React here. Four of them, and all four are load-bearing:
//
//   - useSyncExternalStore, NEVER an effect. `react-hooks/set-state-in-effect`
//     is an error in this repo (DESIGN-SYSTEM.md), and an effect would also
//     paint one frame with everything open.
//   - The snapshot must be STABLE between writes. Parsing the string into a
//     fresh Set on every read hands React a new object every time and it spins
//     forever, so the parse is cached and only invalidated on a write.
//   - A `storage` listener, so a second tab agrees rather than fighting.
//   - Every read and write wrapped: localStorage THROWS in a private window
//     with site data blocked, and a column that cannot remember must still open.

const KEY = "chat:folds";
const listeners = new Set();

// Null means "not parsed yet". The Set itself is the stable snapshot.
let cached = null;

function invalidate() {
  cached = null;
}

function emit() {
  invalidate();
  for (const cb of listeners) cb();
}

function subscribe(callback) {
  // Another tab may have moved it since this one last looked.
  invalidate();
  listeners.add(callback);
  const onStorage = (event) => {
    if (event.key !== null && event.key !== KEY) return;
    invalidate();
    callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function read() {
  if (cached === null) {
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      cached = new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : []);
    } catch {
      // Unreadable, or somebody hand-edited it into nonsense. Everything opens.
      cached = new Set();
    }
  }
  return cached;
}

// The server renders no stored preference, and the same empty Set every time —
// a new one per call is a fresh snapshot, which is the spin above.
const EMPTY = new Set();
function readServer() {
  return EMPTY;
}

// `live` is every fold key the column can currently draw. Anything stored that
// is not in it belongs to a zone or a section that no longer exists — a
// conversation that closed, a street walked out of — and is dropped here rather
// than kept forever. Pruning on WRITE, not in an effect, is what keeps this off
// the render path.
function write(next, live) {
  const keep = live ? [...next].filter((k) => live.has(k)) : [...next];
  try {
    if (keep.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    // Nothing to do: the column still folds, it just forgets again.
  }
  emit();
}

// The shut set, and a toggle. `live` is passed at the call site because only
// the column knows which keys it can draw this render.
export function useFolds() {
  const collapsed = useSyncExternalStore(subscribe, read, readServer);
  const toggle = useCallback((key, live) => {
    const next = new Set(read());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(next, live);
  }, []);
  return [collapsed, toggle];
}
