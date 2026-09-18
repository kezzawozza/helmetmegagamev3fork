"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import {
  applyCollarRequest,
  unlockCollarRequest,
  detonateCollarRequest,
} from "@/app/(app)/character/requestActions";

// The bomb collar's three verbs (docs/systemdocs/COLLAR.md), one dialog, the
// same declaration shape BindDialog uses.
//
// NONE of them has a `fit`. That is the whole design and not an omission: every
// one of these lists everybody standing here, whether or not they are wearing a
// collar, because a picker that showed only the collared would publish who is
// collared to anybody holding a detonator. The server refuses an uncollared
// target by name; you spend a click to learn one person's answer instead of
// reading the room's.
//
// `pool` picks the roster: Apply may target yourself, Unlock and Detonate may
// not (web/lib/peoplePools.js).
export const COLLAR_VERBS = {
  applycollar: {
    title: "Apply Collar",
    question: "Who are you collaring?",
    empty: "There's nobody here to collar.",
    pool: "collarTargets",
    note: "Anybody who could refuse is asked first. Somebody helpless, or yourself, is collared on the spot.",
    confirm: (name) => ({ title: `Put a collar on ${name}?`, confirmLabel: "Put it on them" }),
    run: (id) => applyCollarRequest({ targetCharacterId: id }),
  },
  unlockcollar: {
    title: "Unlock Collar",
    question: "Whose collar are you unlocking?",
    empty: "There's nobody here.",
    pool: "collarOthers",
    note: "The collar comes off in one piece and is yours to keep.",
    confirm: (name) => ({ title: `Unlock ${name}'s collar?`, confirmLabel: "Turn the key" }),
    run: (id) => unlockCollarRequest({ targetCharacterId: id }),
  },
  detonatecollar: {
    title: "Detonate",
    question: "Whose collar are you setting off?",
    empty: "There's nobody here.",
    pool: "collarOthers",
    note: "It kills them outright and leaves no body. Nothing about this can be taken back.",
    confirm: (name) => ({
      title: `Detonate ${name}'s collar?`,
      message: "It kills them outright and leaves no body to bury, loot or carry.",
      confirmLabel: "Detonate",
    }),
    run: (id) => detonateCollarRequest({ targetCharacterId: id }),
  },
};

export default function CollarDialog({ mode, presets, onDone, onClose }) {
  const verb = COLLAR_VERBS[mode];
  const pools = useActionPools();
  const { roster, loading } = useRoster(["people"], {
    seed: { people: { [verb.pool]: pools[verb.pool] ?? [] } },
  });
  const [targetId, setTargetId] = useState(presets?.targetId ?? "");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const people = roster?.people?.[verb.pool] ?? [];
  const target = people.find((t) => t.id === targetId) ?? null;

  async function onSubmit() {
    if (!target) return;
    if (!(await confirm(verb.confirm(target.name)))) return;
    submit(
      () => verb.run(target.id),
      (res) => onDone(noticeLine(mode, res, { name: target.name })),
    );
  }

  return (
    <ActionDialog
      title={verb.title}
      busy={busy}
      error={error}
      loading={loading && people.length === 0}
      empty={!loading && people.length === 0 ? verb.empty : null}
      canSubmit={Boolean(target)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label={verb.question}
        options={people.map((t) => ({ id: t.id, label: t.name }))}
        value={targetId}
        onChange={setTargetId}
      />
      {verb.note && <p className="text-xs text-muted">{verb.note}</p>}
    </ActionDialog>
  );
}
