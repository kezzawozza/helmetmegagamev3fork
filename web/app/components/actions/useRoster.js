"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadActionRoster } from "@/app/(app)/character/rosterActions";

// What a dialog can see from where the character stands, read when the dialog
// opens rather than when the page rendered.
//
// This replaces the router.refresh() RequestActionsProvider#open used to fire:
// a whole server render of the sheet page, every time any dialog opened, to
// keep "who is standing here" honest. The dialog now asks for its own slice
// — people, rooms, corpses, the player's own pockets — through one small
// server action, and paints the page's copy (`seed`) until the answer lands,
// so there is never an empty flash before "nobody is here" is actually true.
//
//   const { roster, loading, error, reload } = useRoster(["people"], { seed });
//
// Only ever called from a mounted dialog, which only mounts on a click — so
// nothing here reads the room on a timer, and the metagaming rule holds: the
// world is looked at when the player asks to act on it.
//
// A short cache (4 s) means opening Bind and then Loot in one gesture is one
// round trip. It is written only by a fetch a click asked for.

const CACHE_TTL_MS = 4000;
const cache = new Map();

function keyFor(need) {
  return [...need].sort().join(",");
}

export default function useRoster(need, { seed = null } = {}) {
  const key = keyFor(need);
  const [state, setState] = useState(() => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { roster: hit.roster, loading: false, error: null };
    return { roster: seed, loading: true, error: null };
  });
  const seq = useRef(0);

  const fetchNow = useCallback(
    (force = false) => {
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return;
      const mine = ++seq.current;
      loadActionRoster({ need: key.split(",").filter(Boolean) })
        .then((res) => {
          if (seq.current !== mine) return;
          if (!res?.ok) {
            setState((prev) => ({ roster: prev.roster, loading: false, error: res?.error ?? "Couldn't see who's here." }));
            return;
          }
          cache.set(key, { at: Date.now(), roster: res });
          setState({ roster: res, loading: false, error: null });
        })
        .catch(() => {
          if (seq.current !== mine) return;
          setState((prev) => ({ roster: prev.roster, loading: false, error: "Couldn't see who's here." }));
        });
    },
    [key],
  );

  useEffect(() => {
    fetchNow(false);
    return () => {
      // A reply for a dialog that has closed is painted for nobody.
      seq.current += 1;
    };
  }, [fetchNow]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    fetchNow(true);
  }, [fetchNow]);

  return { roster: state.roster, loading: state.loading, error: state.error, reload };
}
