"use client";

import { useState } from "react";
import TurnCard from "@/app/(app)/chat/TurnCard";
import MoveDialog from "@/app/(app)/chat/MoveDialog";
import useMyMove from "@/app/(app)/chat/useMyMove";
import { useRefresh } from "./useRefresh";

// The turn card the Chat's YOU column carries, on the sheet's band: when it
// is, whether Moves have locked, and the Move you filed — with the same File
// that opens the same dialog. Same server action, same poll
// (play/useMyMove.js), so the sheet and the chat cannot disagree. There is no
// Edit: a filed Move is final.
//
// Pending offers (a lesson, a binding) still read under it, in the words
// the old sheet's "This turn" row always used — they are why a Move may not be
// filed yet, and the card alone would not say so.
// Every offer kind gets its own words. Anything unlisted used to read as a
// lesson, so a ride offer told both people a lesson was pending.
function offerLine(o) {
  const lesson = `the lesson${o.tagName ? ` in ${o.tagName}` : ""}`;
  if (o.mine) {
    switch (o.kind) {
      case "BIND":
        return `Waiting for ${o.otherName} to agree to be bound.`;
      case "LESSON":
        return `Waiting for ${o.otherName} to accept ${lesson}.`;
      default:
        return `Waiting for ${o.otherName} to answer.`;
    }
  }
  switch (o.kind) {
    case "BIND":
      return `${o.otherName} wants to bind you. Answer in your DMs.`;
    case "CONFESSION":
      return `${o.otherName} asks you to hear their confession. Answer in your DMs.`;
    case "ESCORT":
      return `${o.otherName} wants to take you along. Answer in your DMs.`;
    case "KISS":
      return `${o.otherName} would like to kiss you. Answer in your DMs.`;
    case "SEARCH":
      return `${o.otherName} wants to search you. Answer in your DMs.`;
    default:
      return `${o.otherName} offered a lesson${o.tagName ? ` in ${o.tagName}` : ""}. Answer in your DMs.`;
  }
}

export default function SheetTurn({ moveState, pendingOffers = [] }) {
  const state = useMyMove(moveState ?? { turn: null, move: null, characterId: null });
  const [dialog, setDialog] = useState(null);
  const [refresh] = useRefresh();

  const waiting = pendingOffers.map((o) => (
    <span key={o.id} className="chat-quiet-line">
      {offerLine(o)}
    </span>
  ));

  function done() {
    state.refresh();
    // The rest of the sheet reads the Move too (hasMoved gates Craft and the
    // lesson verbs), so the page re-renders as well.
    refresh();
  }

  return (
    <div className="sheet-turn">
      <TurnCard turn={state.turn} move={state.move} onFile={() => setDialog("move")} />
      {waiting}
      {dialog === "move" && (
        <MoveDialog turn={state.turn} characterId={state.characterId} onClose={() => setDialog(null)} onDone={done} />
      )}
    </div>
  );
}
