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
  bindCharacterRequest,
  freeCharacterRequest,
  crucifyCharacterRequest,
  shackleCharacterRequest,
  tortureCharacterRequest,
} from "@/app/(app)/character/requestActions";

// Bind, Free, Crucify and Torture: one person standing here, picked from a
// chip row. Bind wants the untied, Free and Torture the tied, Crucify anyone
// not already on the cross. Opened from a person's own row the picker is
// skipped altogether (RequestActionsProvider.js#FAST_PATHS) — this dialog is
// the "from the tile" way in.
export const BIND_VERBS = {
  bind: {
    title: "Bind",
    question: "Who are you tying up?",
    empty: "There’s nobody here left to tie up.",
    confirm: (name) => ({ title: `Tie up ${name}?`, confirmLabel: "Tie them up" }),
    run: (id) => bindCharacterRequest({ targetCharacterId: id }),
    fit: (t) => !t.bound,
  },
  free: {
    title: "Free",
    question: "Who are you cutting loose?",
    empty: "Nobody here is bound.",
    confirm: (name) => ({ title: `Cut ${name} loose?`, confirmLabel: "Cut them loose" }),
    run: (id) => freeCharacterRequest({ targetCharacterId: id }),
    fit: (t) => t.bound,
  },
  torture: {
    title: "Torture",
    question: "Who are you torturing?",
    empty: "Nobody here is tied up.",
    note: "It takes your Move. One die, resolved now: what they gave up arrives by DM.",
    confirm: (name) => ({
      title: `Torture ${name}?`,
      message: "It takes your Move. One die, resolved now: what they gave up arrives by DM.",
      confirmLabel: "Torture them",
    }),
    run: (id) => tortureCharacterRequest({ targetCharacterId: id }),
    fit: (t) => t.bound,
  },
  crucify: {
    title: "Crucify",
    question: "Who are you crucifying?",
    empty: "There’s nobody here to put on the cross.",
    note: "They go up on the cross now. They can still speak, but nothing else — and in a turn they are Dying. It doesn't spend your Move.",
    confirm: (name) => ({
      title: `Crucify ${name}?`,
      message: "They go up now, and in a turn they are Dying. It doesn't spend your Move.",
      confirmLabel: "Crucify them",
    }),
    run: (id) => crucifyCharacterRequest({ targetCharacterId: id }),
    fit: (t) => !t.crucified,
  },
  shackle: {
    title: "Shackle",
    question: "Who are you shackling?",
    empty: "Nobody here is bound.",
    confirm: (name) => ({ title: `Shackle ${name}?`, confirmLabel: "Shackle them" }),
    run: (id) => shackleCharacterRequest({ targetCharacterId: id }),
    fit: (t) => t.bound && !t.shackled,
  },
};

export default function BindDialog({ mode, presets, onDone, onClose }) {
  const verb = BIND_VERBS[mode];
  const pools = useActionPools();
  const { roster, loading } = useRoster(["people"], { seed: { people: { bindTargets: pools.bindTargets ?? [] } } });
  const [targetId, setTargetId] = useState(presets?.targetId ?? "");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const people = (roster?.people?.bindTargets ?? []).filter(verb.fit);
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
