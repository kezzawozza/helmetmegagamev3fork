"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FormError from "@/app/components/FormError";

// SEARCH THE SCENE. The archive's trigram index (ArchiveEntry_content_trgm_idx —
// CLAUDE.md's note about why Prisma keeps proposing to drop it), scoped by the route
// to the places this viewer may read. Not a second feed: a hit is a line, a time and a
// place; clicking one takes you TO that line, so results stay a snippet, never a
// rendered row. `q` is trimmed and 3..80 characters, the same bounds the route enforces —
// three because the trigram index cannot serve anything shorter.
const MIN_QUERY = 3;
const DEBOUNCE_MS = 250;

function timeLabel(iso) {
  if (!iso) return "";
  const at = new Date(iso);
  return `${at.toLocaleDateString([], { month: "short", day: "numeric" })} ${at.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

// The words either side of the match. Plain text, never markdown — a mention chip here
// would be the scene leaking into its own index.
function snippet(content, query) {
  const text = String(content ?? "").replace(/\s+/g, " ").trim();
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, 120);
  const from = Math.max(0, at - 40);
  const head = from > 0 ? "…" : "";
  const tail = text.length > from + 120 ? "…" : "";
  return `${head}${text.slice(from, from + 120)}${tail}`;
}

// `notice` is a line the FEED wants said in here. It draws above the results and
// outlives nothing: the feed stops passing it and it is gone.
export default function FeedSearch({ place, onPick, onClose, notice = null }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState(null);
  // Only this place, or everywhere this character can hear. Everywhere is the default.
  const [hereOnly, setHereOnly] = useState(false);
  const inputRef = useRef(null);
  const placeKey = place?.placeKey ?? null;

  // Focus on open. A DOM call in an effect, not a setState.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const url = new URL("/api/feed/search", window.location.origin);
      url.searchParams.set("q", q);
      if (hereOnly && placeKey) url.searchParams.set("place", placeKey);
      fetch(url.pathname + url.search)
        .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => null) }))
        .then(({ ok, data }) => {
          if (cancelled) return;
          if (!ok) {
            setState({ error: data?.error ?? "That search went nowhere." });
            return;
          }
          setState({ rows: data?.rows ?? [], query: q });
        })
        .catch(() => {
          if (!cancelled) setState({ error: "That search went nowhere." });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, hereOnly, placeKey]);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  // Held results are shown only while the query is still long enough to have asked for them.
  const long = query.trim().length >= MIN_QUERY;
  const rows = long ? (state?.rows ?? []) : [];

  return (
    <div className="chat-search" onKeyDown={onKeyDown}>
      <div className="field">
        <label className="sr-only" htmlFor="chat-search-input">
          Search
        </label>
        <input
          id="chat-search-input"
          ref={inputRef}
          value={query}
          maxLength={80}
          placeholder="Search…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {placeKey && (
        <div className="chip-row" role="group" aria-label="How wide to look">
          <button
            type="button"
            className="chip"
            data-active={hereOnly ? undefined : "true"}
            aria-pressed={!hereOnly}
            onClick={() => setHereOnly(false)}
          >
            Everywhere
          </button>
          <button
            type="button"
            className="chip"
            data-active={hereOnly ? "true" : undefined}
            aria-pressed={hereOnly}
            onClick={() => setHereOnly(true)}
          >
            {place?.name ?? "Here"}
          </button>
        </div>
      )}

      {notice && <FormError>{notice}</FormError>}
      {state?.error && <FormError>{state.error}</FormError>}
      {long && state?.rows && rows.length === 0 && <p className="chat-quiet-line">Nobody said that.</p>}

      {rows.length > 0 && (
        <ul className="chat-search-results list-none p-0">
          {rows.map((row) => (
            <li key={row.seq}>
              <button
                type="button"
                className="chat-search-row"
                onClick={() => onPick(row.placeKey, row.seq)}
              >
                <span className="chat-search-who">{row.name ?? "Somebody"}</span>
                <span className="chat-search-where">{row.placeName ?? ""}</span>
                <span className="mono chat-search-when">{timeLabel(row.sentAt)}</span>
                <span className="chat-search-snip">{snippet(row.content, state.query)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
