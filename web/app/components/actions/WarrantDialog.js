"use client";

import { useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { FULL_NAME_LIMIT } from "@/lib/characterName";
import { arrestWarrantRequest } from "@/app/(app)/character/cerberonActions";

// The warrant types its man instead of picking him, the Engrave reasoning: a
// dropdown here would be a roster of everybody alive, handed to anyone holding
// a badge. The whole name, either the full display form or just first and
// last — first names repeat, and swearing one out against the wrong man is not
// a thing to make easy.
export default function WarrantDialog({ mode, onDone, onClose }) {
  const [name, setName] = useState("");
  const { submit, busy, error } = useSubmit();

  return (
    <ActionDialog
      title="Arrest warrant"
      busy={busy}
      error={error}
      canSubmit={Boolean(name.trim())}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => arrestWarrantRequest({ name }),
          (res) => onDone(noticeLine(mode, res, { name: name.trim() })),
        )
      }
    >
      <label className="field">
        <span className="field-label">Whose name?</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoComplete="off"
          maxLength={FULL_NAME_LIMIT}
          required
          data-autofocus
        />
      </label>
    </ActionDialog>
  );
}
