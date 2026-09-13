"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { scoreMatch } from "@/lib/fuzzySearch";
import { createStagedDeaths, updateStagedDeath } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import useEscapeLayer from "./escapeLayers";

// Stage an INSTANTANEOUS death: fires at the push, through the same
// db/lib/characterDeath.js#applyDeathToRow every other death path in the
// game uses (db/lib/stagedPush.js). Nothing touches the player until the
// turn actually ends — the same rule every other staged effect follows.
//
// A separate composer rather than a mode inside EffectComposer.js, for the
// same reason TransferComposer and RoomEffectComposer are separate: a death
// cannot combine with a resources/tagPoints/tagOps/locationId delta on the
// same row — the character won't be there to receive any of them, and
// db/lib/stagedPush.js short-circuits on a death payload before considering
// any other key.
//
// One target or many at once (the "the cave-in kills three of them" case),
// mirroring EffectComposer's own multi-target/batch shape exactly.

const SEARCH_LIMIT = 12;

export default function DeathComposer({
  moveId = null,
  cavingRollId = null,
  existing = null,
  defaultTarget = null,
  roster,
  onDone,
  onCancel,
}) {
  const [targets, setTargets] = useState(() => {
    if (existing) return [{ id: existing.targetCharacterId, name: existing.targetName }];
    return defaultTarget ? [defaultTarget] : [];
  });
  const [reason, setReason] = useState(() => existing?.death?.reason ?? "");
  const [gib, setGib] = useState(() => existing?.death?.gib ?? false);
  const [targetSearch, setTargetSearch] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // The prefilled target alone does not count as unsaved work, the same
  // exemption EffectComposer makes — otherwise every composer opens dirty.
  const { markDirty, markClean, guardedClose } = useDirtyGuard({
    alsoDirty: !existing && Boolean(reason.trim() || gib),
  });

  useEscapeLayer(() => {
    if (!pending) guardedClose(onCancel);
  });

  const targetMatches = useMemo(() => {
    const q = targetSearch.trim();
    if (!q) return [];
    const chosen = new Set(targets.map((t) => t.id));
    return roster
      .filter((c) => !chosen.has(c.id))
      .map((c) => ({
        c,
        match: scoreMatch(q, { name: c.name, role: c.roleTitle, faction: c.factionName, zone: c.zoneName, username: c.username }),
      }))
      .filter((r) => r.match)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, SEARCH_LIMIT)
      .map((r) => r.c);
  }, [targetSearch, roster, targets]);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = existing
          ? await updateStagedDeath({ stagedEffectId: existing.id, reason, gib })
          : await createStagedDeaths({
              targetCharacterIds: targets.map((t) => t.id),
              moveId,
              cavingRollId,
              reason,
              gib,
            });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        onDone(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <Modal
      modeless
      title={existing ? "Edit staged death" : "Stage a death"}
      onClose={() => !pending && guardedClose(onCancel)}
      width="widest"
    >
      <div className="mt-3 flex flex-col gap-4">
        <section className="composer-group">
          <h3 className="composer-group-title">Who dies</h3>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                disabled={Boolean(existing)}
                onClick={() => {
                  setTargets((prev) => prev.filter((p) => p.id !== t.id));
                  markDirty();
                }}
                title={existing ? undefined : "Remove target"}
              >
                {t.name}
                {!existing && " ✕"}
              </button>
            ))}
            {!targets.length && <span className="text-sm text-muted">nobody yet</span>}
          </div>
          {!existing && (
            <label className="field">
              <span className="field-label">Add a target</span>
              <input
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                placeholder="name, role, faction, zone…"
              />
            </label>
          )}
          {targetMatches.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {targetMatches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setTargets((prev) => [...prev, { id: c.id, name: c.name }]);
                    setTargetSearch("");
                    markDirty();
                  }}
                >
                  + {c.name}
                  {c.factionName ? <span className="text-muted"> · {c.factionName}</span> : null}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="composer-group">
          <h3 className="composer-group-title">How</h3>
          <label className="field">
            <span className="field-label">Cause of death</span>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                markDirty();
              }}
              placeholder="They bled out from the wound they took in the duel."
              rows={3}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={gib}
              onChange={(e) => {
                setGib(e.target.checked);
                markDirty();
              }}
            />
            Gibbed — no corpse (an explosion, a rite, vaporization). Leaves nothing to loot, carry,
            bury or revive from, and the curse it leaves is permanent (CORPSES.md §1a, §7).
          </label>
        </section>

        <FormError>{error}</FormError>

        <div className="modal-actions modal-actions--sticky">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onCancel)} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={pending || !targets.length || !reason.trim()}
          >
            {pending ? "Working…" : existing ? "Save" : "Stage it"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
