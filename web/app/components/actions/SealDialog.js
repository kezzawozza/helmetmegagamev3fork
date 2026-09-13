"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { sealLetter } from "@/app/(app)/character/paperActions";
// Safe in a client bundle — paper.js requires only ./reading -> ./examineVision
// and neither touches prisma. One cap, so the counter and the server agree.
import { TITLE_MAX } from "@lifeweb/db/lib/paper";

// Seal Letter: which written letter, whose wax, and — if the sheet arrived
// with no name on it — what to call it (PAPERWORK.md). The title rides through
// the seal now and comes back when the wax is broken, so a courier carrying
// two closed letters can tell them apart without opening one.
export default function SealDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const letters = pools.sealOptions?.letters ?? [];
  const stamps = pools.sealOptions?.stamps ?? [];
  const [tagId, setTagId] = useState("");
  const [stampId, setStampId] = useState(stamps.length === 1 ? stamps[0].tagId : "");
  const [title, setTitle] = useState("");
  const { submit, busy, error } = useSubmit();

  const letter = letters.find((o) => o.tagId === tagId) ?? null;
  // Set once: a sheet the writer already named keeps that name.
  const naming = Boolean(letter) && !letter.titled;

  return (
    <ActionDialog
      title="Seal Letter"
      submitLabel="Seal it"
      busy={busy}
      error={error}
      empty={letters.length === 0 ? "You aren't carrying a written letter to close." : null}
      canSubmit={Boolean(tagId && stampId)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => sealLetter({ tagId, stampTagId: stampId, title: naming ? title : "" }),
          (res) => onDone(`${res.name ?? "The letter"} is sealed.`),
        )
      }
    >
      <ChipPicker
        label="Which letter?"
        options={letters.map((o) => ({ id: o.tagId, label: o.name, note: o.excerpt ?? null }))}
        value={tagId}
        onChange={setTagId}
      />
      {naming && (
        <label className="field">
          <span className="field-label">Name it (optional)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
            maxLength={TITLE_MAX}
          />
          <span className="text-xs text-muted">
            Written on the outside, above the wax. Anyone handling it reads this; what is inside stays shut.
          </span>
        </label>
      )}
      <ChipPicker label="Whose wax?" options={stamps.map((o) => ({ id: o.tagId, label: o.name }))} value={stampId} onChange={setStampId} />
    </ActionDialog>
  );
}
