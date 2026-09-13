"use client";

import { useState } from "react";
import { DM_CHOICE, dmActionLabels } from "@lifeweb/db/lib/dmActions";
import { answerDmAction } from "@/app/(app)/chat/dmActions";

// The buttons under a DM that asks something — an offer's Accept/Decline, a
// seat's Decline, the keyed way's Yes/No, a tax's Refuse/Partial. On Discord
// these are message components; here they are derived from the row the DM
// names (db/lib/dmActions.js).
//
// The buttons disable on click, before the answer lands. Discord's guard
// against a double-submit is interaction.update() taking the components off the
// message; the web has no such primitive, and the server action's re-check is a
// correctness guard, not a UX one.
//
// Once answered, the outcome replaces the buttons — the same shape the bot
// leaves behind, so the thread reads as a record afterwards.
export default function DmActionRow({ action }) {
  const labels = dmActionLabels(action);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);

  if (!labels) return null;

  async function answer(choice, value = null) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await answerDmAction(action.kind, action.id, choice, value);
      // A bad number keeps the field open so it can be fixed.
      if (choice === DM_CHOICE.PARTIAL && !result?.ok && result?.line === "Enter a number.") {
        setError(result.line);
        setBusy(false);
        return;
      }
      setOutcome(result?.line ?? "That didn't go through. Try again.");
    } catch {
      setOutcome("That didn't go through. Try again.");
      setBusy(false);
    }
  }

  if (outcome !== null) return <p className="dm-action-outcome">{outcome}</p>;

  if (asking) {
    return (
      <form
        className="dm-action-row"
        onSubmit={(e) => {
          e.preventDefault();
          answer(DM_CHOICE.PARTIAL, amount);
        }}
      >
        <label className="field">
          <span className="field-label">How much do you want to pay instead?</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className="mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <p className="dm-action-outcome">{error}</p>}
        <button type="submit" className="btn" disabled={busy}>
          {labels.partial}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setAsking(false)}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="dm-action-row">
      {labels.accept && (
        <button type="button" className="btn" disabled={busy} onClick={() => answer(DM_CHOICE.ACCEPT)}>
          {labels.accept}
        </button>
      )}
      {labels.decline && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => answer(DM_CHOICE.DECLINE)}>
          {labels.decline}
        </button>
      )}
      {labels.partial && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setAsking(true)}>
          {labels.partial}
        </button>
      )}
    </div>
  );
}
