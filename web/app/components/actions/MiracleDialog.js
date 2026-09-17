"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { performMiracleRequest } from "@/app/(app)/character/requestActions";

// Perform Miracle: a Saint picks somebody else standing here and one of their
// Moderate-or-lesser wounds. Free, twice a turn, no ⬢, no Move, no Medical
// training. Shape: two chip rows, same as Heal but stripped of payer, site
// hints, and the item-cure shortcut — see docs/tags.yaml `saint:`.

export default function MiracleDialog({ mode, presets, onDone, onClose }) {
  const pools = useActionPools();
  // The pools are keyed now ("character:<id>" / "hood:<token>"), so the self
  // row is matched by its KEY rather than by a bare id.
  const selfKey = pools.selfId ? `character:${pools.selfId}` : null;
  const { roster, loading } = useRoster(["people"], {
    seed: { people: { miracleTargets: pools.miracleTargets ?? [] } },
  });
  const targets = (roster?.people?.miracleTargets ?? []).filter((t) => t.id !== selfKey);
  const miraclesLeft = roster?.people?.miraclesLeft ?? pools.miraclesLeft ?? 0;

  const [patientId, setPatientId] = useState(presets?.patientId ?? "");
  const [tagId, setTagId] = useState("");
  const { submit, busy, error } = useSubmit();

  const patient = targets.find((t) => t.id === patientId) ?? null;
  const affliction = patient?.miraculable.find((h) => h.tagId === tagId) ?? null;

  async function onSubmit() {
    if (!patient || !affliction) return;
    submit(
      () =>
        performMiracleRequest({
          targetCharacterId: patient.id,
          tagId: affliction.tagId,
        }),
      (res) => onDone(noticeLine(mode, res, { name: patient.name, self: false })),
    );
  }

  const empty = !loading && targets.length === 0
    ? "Nobody here has a wound a miracle could touch."
    : miraclesLeft <= 0
      ? "You've used both miracles this turn."
      : null;

  return (
    <ActionDialog
      title="Perform Miracle"
      submitLabel="Cure"
      busy={busy}
      error={error}
      loading={loading && targets.length === 0}
      empty={empty}
      canSubmit={Boolean(patient && affliction) && miraclesLeft > 0}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Who are you healing?"
        options={targets.map((t) => ({ id: t.id, label: t.name }))}
        value={patientId}
        onChange={(id) => {
          setPatientId(id);
          setTagId("");
        }}
      />
      {patient && (
        <ChipPicker
          label="What are you curing?"
          options={patient.miraculable.map((h) => ({ id: h.tagId, label: h.tagName }))}
          value={tagId}
          onChange={setTagId}
          emptyLabel="Nothing on them a miracle could touch."
        />
      )}
      {patient && (
        <p className="text-xs text-muted">
          {`Free. ${miraclesLeft === 1 ? "1 miracle" : `${miraclesLeft} miracles`} left this turn.`}
        </p>
      )}
    </ActionDialog>
  );
}
