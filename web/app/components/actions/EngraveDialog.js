"use client";

import { useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { ENGRAVE_RESOURCE_COST } from "@/lib/constants";
import { FULL_NAME_LIMIT } from "@/lib/characterName";
import { engraveHeadstoneRequest } from "@/app/(app)/character/requestActions";

// Engrave types its target instead of picking it — a dropdown would be a list
// of the dead, and this one searches every zone (REQUESTS.md §5d). No "nobody
// here" line either, for the same reason: you type a name and find out.
//
// The WHOLE name, since first names repeat and a mourner who knew exactly
// whose stone they meant used to be turned away. Either form counts: the full
// display name, or just first and last (db/lib/characterName.js).
export default function EngraveDialog({ mode, onDone, onClose }) {
  const [name, setName] = useState("");
  const { submit, busy, error } = useSubmit();

  return (
    <ActionDialog
      title="Engrave"
      busy={busy}
      error={error}
      canSubmit={Boolean(name.trim())}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => engraveHeadstoneRequest({ name }),
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
      {/* PLACEHOLDER — Bascinet's wording pending. It is half a Move now, not a whole turn. */}
      <p className="text-xs text-muted">Costs {ENGRAVE_RESOURCE_COST} ⬢ and half your turn.</p>
    </ActionDialog>
  );
}
