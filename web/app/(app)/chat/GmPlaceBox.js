"use client";

import { useState } from "react";
import GmNoticeboardDialog from "./GmNoticeboardDialog";

// WHAT A GM DOES TO A PLACE, in the column where they are already reading it.
//
// One thing now: the board. The ambient-line box that used to sit above it —
// "Say something here" — is gone, because the composer at the foot of the
// scene is a box a GM can already type into, and two writing boxes on one
// screen is one too many. A GM with a line of scenery to lay down types it
// there, or on /gm/dev, which still carries the full ambient form.
export default function GmPlaceBox({ selected }) {
  const [board, setBoard] = useState(false);
  const placeKey = selected?.placeKey ?? null;

  // Nothing to draw where there is no board — an empty card with a heading on
  // it is a promise the column cannot keep.
  if (!(selected?.kind === "loc" && selected.hasBoard && placeKey)) return null;

  return (
    <div className="chat-card">
      <div className="chat-buttons">
        <button type="button" className="btn-secondary" onClick={() => setBoard(true)}>
          Noticeboard
        </button>
      </div>
      {board && <GmNoticeboardDialog placeKey={placeKey} onClose={() => setBoard(false)} />}
    </div>
  );
}
