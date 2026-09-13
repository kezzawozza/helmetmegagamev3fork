"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { CUSTOM_DESCRIPTION_MAX } from "@/lib/customCraft";
import { brandCharacterRequest } from "@/app/(app)/character/requestActions";

// Brand: somebody bound or incapacitated standing here, and a few words for
// what the iron marks them with (TORTURE.md §8). `doseTargets` is Poison's
// own "helpless person here" pool (web/lib/peoplePools.js) — the broader
// INCAPACITATING_SLUGS class, not just Bound, which is what "incapacitated /
// bound" asks for and why this reuses Poison's pool rather than Torture and
// Mutilate's narrower bindTargets.
export default function BrandDialog({ mode, onDone, onClose }) {
  const pools = useActionPools();
  const [targetId, setTargetId] = useState("");
  const [description, setDescription] = useState("");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  const doseTargets = pools.doseTargets ?? [];
  const target = doseTargets.find((t) => t.id === targetId) ?? null;
  const cleaned = description.trim();

  async function onSubmit() {
    if (!target || !cleaned) return;
    if (!(await confirm({
      title: `Brand ${target.name}?`,
      message: "It costs you nothing, and it never comes off.",
      confirmLabel: "Brand them",
    })))
      return;
    submit(
      () => brandCharacterRequest({ targetCharacterId: target.id, description: cleaned }),
      (res) => onDone(noticeLine(mode, res, { name: target.name })),
    );
  }

  return (
    <ActionDialog
      title="Brand"
      busy={busy}
      error={error}
      empty={doseTargets.length === 0 ? "Nobody here is bound or incapacitated." : null}
      canSubmit={Boolean(target && cleaned)}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <ChipPicker
        label="Who are you branding?"
        options={doseTargets.map((t) => ({ id: t.id, label: `${t.name} — ${t.condition}` }))}
        value={targetId}
        onChange={setTargetId}
      />
      <label className="field">
        <span className="field-label">Describe the brand</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={CUSTOM_DESCRIPTION_MAX}
        />
      </label>
      <p className="text-xs text-muted">It&apos;s permanent — there&apos;s no taking it back.</p>
    </ActionDialog>
  );
}
