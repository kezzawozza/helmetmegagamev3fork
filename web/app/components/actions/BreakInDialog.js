"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { UNRULY_ARELITZ_SLUG } from "@lifeweb/db/lib/constants";
import { breakInArelitzRequest } from "@/app/(app)/character/requestActions";

// Breaking in an unruly arelitz (db/lib/arelitz.js, ARELITZ.md §6): one
// unruly arelitz in reach — held, or standing in a stable's floor. Reuses
// the SAME `corpses` pool Butcher reads (livestockInReach concatenates onto
// it — db/lib/corpses.js), filtered down to the one slug this dialog cares
// about, rather than a second server round-trip for an identical shape.
function unrulyId(row) {
  return `${row.tagId}@${row.sourceKey}`;
}

function unrulyLabel(row) {
  return `${row.tagName} — ${row.source.name}`;
}

export default function BreakInDialog({ onDone, onClose }) {
  const pools = useActionPools();
  const { roster, loading } = useRoster(["corpses"], { seed: { corpses: pools.corpses ?? [] } });
  const [key, setKey] = useState("");
  const { submit, busy, error } = useSubmit();

  const list = (roster?.corpses ?? []).filter((c) => c.tagSlug === UNRULY_ARELITZ_SLUG);
  const chosen = list.find((c) => unrulyId(c) === key) ?? null;

  function onSubmit() {
    if (!chosen) return;
    submit(
      () => breakInArelitzRequest({ tagId: chosen.tagId, sourceKey: chosen.sourceKey }),
      (res) => onDone(res.line ?? "You start working the arelitz."),
    );
  }

  return (
    <ActionDialog
      title="Break In"
      busy={busy}
      error={error}
      loading={loading && list.length === 0}
      empty={!loading && list.length === 0 ? "There's no unruly arelitz here." : null}
      canSubmit={Boolean(chosen)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Which arelitz?"
        options={list.map((c) => ({ id: unrulyId(c), label: unrulyLabel(c) }))}
        value={key}
        onChange={setKey}
      />
    </ActionDialog>
  );
}
