"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { birdReplyRequest } from "@/app/(app)/character/requestActions";

// Answering a bird's letter (docs/systemdocs/BIRD.md) — the web's half of the
// Reply button Discord puts on the letter's own DM.
//
// IT IS A PICKER, NOT A TEXT BOX, for the same reason Discord's is: replying
// means handing the bird a letter you are already holding. You write it with
// the Write button, which has a real text box and no clock on it, and then
// choose here which of your papers goes back — which is also what lets a reply
// go out sealed.
//
// Both lists come from the server (web/lib/selfPools.js) and both are
// re-checked by db/lib/birdReply.js when the answer is sent, so a window that
// shuts while this sits open refuses rather than half-succeeds.
export default function BirdReplyDialog({ onDone, onClose }) {
  const pools = useActionPools();
  // Usually exactly one. More than one only when two birds are standing there
  // at once, which the window makes rare but does not forbid.
  const waiting = pools.birdReplies ?? [];
  const letters = pools.letterOptions ?? [];
  const [birdMessageId, setBirdMessageId] = useState(waiting.length === 1 ? waiting[0].id : "");
  const [tagId, setTagId] = useState(letters.length === 1 ? letters[0].tagId : "");
  const { submit, busy, error } = useSubmit();

  const answering = waiting.find((w) => w.id === birdMessageId) ?? null;

  return (
    <ActionDialog
      title="Answer a letter"
      submitLabel="Send it back"
      busy={busy}
      error={error}
      empty={
        waiting.length === 0
          ? "No bird is waiting on you."
          : letters.length === 0
            ? "You have nothing written to send back. Use Write first, then answer before the bird goes."
            : null
      }
      canSubmit={Boolean(birdMessageId && tagId)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => birdReplyRequest({ birdMessageId, tagId }),
          (res) => onDone(res?.line ?? "The bird is away."),
        )
      }
    >
      {waiting.length > 1 && (
        <ChipPicker
          label="Which bird?"
          options={waiting.map((w) => ({ id: w.id, label: w.senderName }))}
          value={birdMessageId}
          onChange={setBirdMessageId}
        />
      )}
      <ChipPicker
        label="Which letter goes back?"
        options={letters.map((o) => ({ id: o.tagId, label: o.name, note: o.excerpt ?? null }))}
        value={tagId}
        onChange={setTagId}
      />
      <p className="text-xs text-muted">
        {answering
          ? `The bird takes it to ${answering.senderName}, out of your hands. It will not wait past next turn.`
          : "The bird takes it out of your hands. It will not wait past next turn."}
      </p>
    </ActionDialog>
  );
}
