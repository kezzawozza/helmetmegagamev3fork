"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "./ConfirmProvider";
import { soundTrumpet } from "@/app/(app)/character/trumpetActions";

// Its own control rather than an entry in ActionGrid, because everything in
// that grid opens a dialog through RequestActionsProvider and this commits
// straight away — the same shape as the equip toggle. Threading a direct-fire
// case through the generic grid for one button would complicate the machinery
// for every other action in it.
//
// It asks first. One click is heard across most of the barony and cannot be
// taken back, which is the same reason the bell rope makes you type RING into
// a modal before it will ring.
export default function SoundTrumpetButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [sounded, setSounded] = useState(false);
  const confirm = useConfirm();

  async function onClick() {
    setError(null);
    // Awaited OUTSIDE startTransition, or the dialog never renders — the rule
    // RequestActionsProvider.js documents.
    const ok = await confirm({
      title: "Sound the trumpet?",
      message: "It will be heard for a long way around, and everyone will know something is happening here.",
      confirmLabel: "Sound it",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await soundTrumpet();
      if (result?.ok) setSounded(true);
      else setError(result?.error ?? "Couldn't sound it.");
    });
  }

  // It rides at the end of the verb strip (ActionGrid.js), in its own hairline
  // group, as the one filled red .btn among the bevelled greys — the mockup's
  // Trumpet. No caption over it: a group of one in a strip of verbs does not
  // need a label saying it is the trumpet when the button says Trumpet.
  return (
    <>
      <button type="button" className="btn action-strip-item" onClick={onClick} disabled={pending}>
        {pending ? "Sounding…" : "Trumpet"}
      </button>
      {sounded && !error ? <span className="text-muted text-sm">You sound it.</span> : null}
      <FormError>{error}</FormError>
    </>
  );
}
