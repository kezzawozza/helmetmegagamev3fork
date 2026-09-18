"use client";

import { useEffect, useState } from "react";
import { describeTurn, untilLabel } from "@/lib/turnFormat";
import { moveKindLabel } from "./MoveDialog";

// When it is, when Moves stop being accepted, and what this character has
// already said they are doing. The one card at the top of the YOU column,
// because everything under it is answered by "have you moved yet".
//
// The countdown and the cutoff it counts to are shared with the Move dialog,
// which asks the same question in its own header — so untilLabel lives in
// web/lib/turnFormat.js and both read the one copy.
//
// The turn used to be two chips (a label pill and a countdown pill) sitting
// alone above the Move button, which read as two more buttons rather than
// the plain fact they are. It is one text line now — a chip is for a value
// that just IS (DESIGN-SYSTEM §5a), and a locked turn is a state, not a
// value, so only that case still gets a small tone chip.
export default function TurnCard({ turn, move, onFile, onEdit }) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!turn) return <p className="chat-quiet-line">No turn is open.</p>;

  const { label } = describeTurn({ number: turn.number, dayNumber: turn.dayNumber });
  // `shut` outranks the countdown, and is checked separately from `locked`: out of session there is no cutoff to count to
  // and `locked` is false, so reading it alone would draw an open turn on a closed game (db/lib/turnGate.js).
  const countdown = turn.shut ? "not in session" : turn.locked ? "locked" : untilLabel(turn.closesAt, now);

  return (
    <div className="chat-move">
      {/* The mockup's `.turn-line`/`.warn` (docs/design/mockups/chat/index.html):
          the server's minute and the browser's are not the same minute. */}
      <p className="turn-line" suppressHydrationWarning>
        {label}
        {countdown && (
          <>
            {" — Moves close "}
            <span className="warn">{countdown}</span>
          </>
        )}
      </p>

      {move ? (
        /* The words are the point, so they are what this draws. The » stays:
           it is the house mark for a line quoting somebody's own words
           (CLAUDE.md) — the mockup's `.quote .mark`.

           Still clamped until clicked, because a Move can be a paragraph and
           neither surface is the place to read the whole of one by default — so
           the press stays "show me the rest", and Change is its own button
           underneath rather than a second meaning for the same tap. */
        <>
          <button
            type="button"
            className="chat-move-text quote"
            data-open={open ? "true" : undefined}
            onClick={() => setOpen((was) => !was)}
          >
            <span className="mark" aria-hidden="true">
              »
            </span>{" "}
            <b>{moveKindLabel(move.kind)}</b> — {move.description}
          </button>
          {/* Only a Gambit still pending at the cutoff (chat/actions.js#myMove). A
              Anything the game filed has already happened. Polled, so
              it disappears on its own when Moves lock. History was asked for
              and dropped (Bascinet's answer): there is no per-character Move
              log to show. */}
          {move.editable && onEdit && (
            <div className="chat-buttons">
              <button type="button" className="btn" onClick={onEdit}>
                Change…
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="chat-buttons">
          <button type="button" className="btn" disabled={Boolean(turn.shut) || turn.locked} onClick={onFile}>
            Move…
          </button>
        </div>
      )}
    </div>
  );
}
