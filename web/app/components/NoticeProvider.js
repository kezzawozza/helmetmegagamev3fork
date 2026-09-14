"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import MarkdownContent from "./MarkdownContent";

// The result notice: one line that says what a button just did. Mounted once in layout.js;
// its stack (.notice-stack) is NOT a .modal-overlay — Modal.js#dialogHoldsKeyboard counts
// those, and a notice must never make a desk think a dialog is open. State is only ever set
// from a click path or inside a timeout callback — never synchronously in an effect, which is an error in this repo.

const NoticeContext = createContext(null);

const DEFAULT_TTL = 6000;
// Past this the stack is a wall; the oldest drops when a new one arrives.
const MAX_CARDS = 3;

export function useNotice() {
  const ctx = useContext(NoticeContext);
  if (!ctx) throw new Error("useNotice must be used within a NoticeProvider");
  return ctx;
}

export default function NoticeProvider({ children }) {
  const [cards, setCards] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const arm = useCallback(
    (card) => {
      const t = timers.current.get(card.id);
      if (t) clearTimeout(t);
      timers.current.set(
        card.id,
        setTimeout(() => dismiss(card.id), card.ttl),
      );
    },
    [dismiss],
  );

  const hold = useCallback((id) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const notice = useCallback(
    (input) => {
      const opts = typeof input === "string" ? { text: input } : (input ?? {});
      if (!opts.text) return null;
      const id = ++seq.current;
      const card = {
        id,
        text: String(opts.text),
        tone: opts.tone === "bad" ? "bad" : "info",
        rows: Array.isArray(opts.rows) && opts.rows.length ? opts.rows : null,
        ttl: opts.ttl ?? (Array.isArray(opts.rows) && opts.rows.length ? DEFAULT_TTL * 2 : DEFAULT_TTL),
      };
      setCards((prev) => {
        const next = [...prev, card];
        // Drop the oldest past the cap, and its timer with it.
        while (next.length > MAX_CARDS) {
          const gone = next.shift();
          const t = timers.current.get(gone.id);
          if (t) clearTimeout(t);
          timers.current.delete(gone.id);
        }
        return next;
      });
      arm(card);
      return id;
    },
    [arm],
  );

  const value = useMemo(() => notice, [notice]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {/* Always mounted so the live region exists before the first notice. */}
      <div className="notice-stack" role="status" aria-live="polite" aria-atomic="false">
        {cards.map((card) => (
          <div
            key={card.id}
            className="notice-card"
            data-tone={card.tone}
            onMouseEnter={() => hold(card.id)}
            onMouseLeave={() => arm(card)}
            onFocus={() => hold(card.id)}
            onBlur={() => arm(card)}
            onKeyDown={(e) => {
              if (e.key === "Escape") dismiss(card.id);
            }}
          >
            <div className="notice-body">
              {/* Markdown, not a raw string — a notice carries the same DM sentence
                  the bot would send, so it needs Discord's vocabulary (not remarkChat). */}
              <MarkdownContent content={card.text} className="notice-text" />
              {card.rows && (
                <ul className="notice-rows">
                  {card.rows.map((row, i) => (
                    <li key={`${row.name}-${i}`}>
                      <span>{row.name}</span>
                      {row.note ? <span className="text-muted"> · {row.note}</span> : null}
                      {row.mark ? <span className="notice-mark"> {row.mark}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="notice-close"
              aria-label="Dismiss"
              onClick={() => dismiss(card.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}
