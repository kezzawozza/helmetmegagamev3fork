"use client";

import FormError from "@/app/components/FormError";
import { useState, useTransition } from "react";
import { wipeGameData } from "./actions";

// Restart Game's confirm/error/success wrapper — same reasons EndTurnButton.js exists
// for End Turn: a pending server action blocks client-side navigation, and
// wipeGameData now returns { ok, error } rather than throwing into a
// non-existent error.js, so something has to render the error. Typing "WIPE"
// in the field below is already the confirmation step, so this deliberately
// doesn't stack a useConfirm() dialog on top of it.
//
// The success line matters more than it looks: the action returns as soon as
// the database work commits and hands every Discord call to after(), so
// "Wiping…" now flashes past in a second or two while channels keep clearing
// for minutes afterwards. Without a word about that, a GM reasonably concludes
// it did nothing.
export default function WipeGameButton({ hasPacket = false }) {
  const [confirmText, setConfirmText] = useState("");
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    setError(null);
    setDone(false);
    startTransition(async () => {
      // wipeGameData catches its own failures, but a transport error can
      // reject before that try block even runs — same reasoning as
      // EndTurnButton.js's onClick.
      try {
        const res = await wipeGameData(formData);
        if (res?.ok) {
          setDone(true);
          setConfirmText("");
        } else {
          setError(res?.error ?? "Something went wrong.");
        }
      } catch {
        setError("Could not reach the server. Nothing was changed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label className="field">
        <span className="field-label">This game&apos;s transcript</span>
        <select name="archive" value={keep ? "keep" : "discard"} onChange={(e) => setKeep(e.target.value === "keep")}>
          <option value="discard">Discard it — a playtest, keep nothing</option>
          <option value="keep">Keep it — read it later on /archive</option>
        </select>
      </label>
      <p className="ops-lede">
        {keep
          ? "The transcript leaves the database either way. Keeping it means the packet in the bucket becomes the copy that survives, so Restart Game will refuse until one has been written."
          : "Nothing of this game is kept — not the transcript, not its entry in the archive picker. This is the right answer for a playtest."}
      </p>
      {keep && !hasPacket ? (
        <p className="ops-lede">» <em>No packet yet. Press Archive this game above first.</em></p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">Type WIPE to confirm</span>
          <input
            type="text"
            name="confirm"
            autoComplete="off"
            className="w-40"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-danger" disabled={pending}>
          {pending ? "Wiping…" : "Wipe & restart game"}
        </button>
      </div>
      <FormError>{error}</FormError>
      {done ? (
        <p className="text-sm">
          » <em>Game wiped.</em> Messages are still clearing and the Discord mirror is still repairing structure in the background — they&apos;ll take a few minutes.
        </p>
      ) : null}
    </form>
  );
}
