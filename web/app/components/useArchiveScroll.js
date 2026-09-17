"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The transcript's infinite scroll, shared by the two surfaces that read it:
// the /archive page and the GM inspector's Archive tab. Both page through
// GET /api/archive with the same keyset cursor, so the scrolling itself is one
// piece of code rather than two that could drift about when they stop.
//
// `first` is the page's server-rendered opening screen. The inspector has no
// SSR to seed from, so when it is absent the hook fetches screen one itself —
// that is the only difference between the two callers.
//
// Callers key the component on `query`, so a filter change REMOUNTS this
// rather than reconciling it. There is no "reset when the query changes"
// effect, and there should not be: react-hooks/set-state-in-effect is an error
// in this repo, and clearing rows from an effect would paint the old screen
// first anyway.
export default function useArchiveScroll({ query, first = null }) {
  const [rows, setRows] = useState(first?.rows ?? []);
  const [cursor, setCursor] = useState(first?.cursor ?? null);
  const [done, setDone] = useState(first ? first.done : false);
  const [failed, setFailed] = useState(false);
  // Seeded callers have their first screen already; the inspector does not, and
  // renders a loading line until it lands.
  const [loaded, setLoaded] = useState(Boolean(first));
  // A ref, not state: two intersections can fire before a re-render lands, and
  // a state flag would let the second one through and fetch the screen twice.
  const loading = useRef(false);

  const url = useCallback(
    (at) => `/api/archive?${query}${query && at ? "&" : ""}${at ? `cursor=${encodeURIComponent(at)}` : ""}`,
    [query],
  );

  const more = useCallback(async () => {
    if (loading.current || done || !cursor) return;
    loading.current = true;
    setFailed(false);
    try {
      const res = await fetch(url(cursor));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows((prev) => [...prev, ...data.rows]);
      setCursor(data.cursor);
      setDone(data.done || !data.cursor);
    } catch {
      // Say so rather than looking like the end of the transcript. A silent
      // stop reads as "that is all there was", which is a lie about a record.
      setFailed(true);
    } finally {
      loading.current = false;
    }
  }, [cursor, done, url]);

  // Screen one, for a caller with nothing seeded. setState lands after the
  // await, never synchronously in the effect body.
  useEffect(() => {
    if (first) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url(null));
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        setRows(data.rows);
        setCursor(data.cursor);
        setDone(data.done || !data.cursor);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [first, url]);

  // The sentinel wires its own observer through a ref callback rather than an
  // effect — the element is the thing being watched, so it is the thing that
  // should set the watch up and tear it down. No `root`: intersection against
  // the viewport already accounts for a scrolling ancestor clipping the
  // sentinel, which is what the inspector's own scroll container does.
  const sentinel = useCallback(
    (node) => {
      if (!node) return undefined;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) more();
        },
        { rootMargin: "600px" },
      );
      io.observe(node);
      return () => io.disconnect();
    },
    [more],
  );

  return { rows, done, failed, loaded, more, sentinel };
}
