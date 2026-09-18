"use client";

import { useEffect, useState, useTransition } from "react";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { describeAudit } from "@/lib/auditNarrative";
import AuditSegments from "../audit/AuditSegments";
import { getCharacterAuditSlice, keepDesireClaim, rejectDesireClaim } from "./actions";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";

// The arbitration desk for one fulfilled Desire claim — see
// docs/systemdocs/DESIRES.md §6. Modelled on CavingDesk.js: no lock, no
// composers, no push involvement — a claim already paid the instant it was
// filed, so this desk's whole job is deciding whether it stands.
//
// HONESTY ABOUT THE LIMIT, up front: the mini audit log below is a
// convenience over the MINORITY of Desires that leave a mechanical trace. A
// claim of "drink some Ravenheart Red" shows up in the log as a consumed
// tag; a claim of "earn a compliment" never will, because nothing about it
// is mechanical. The filter below (prefilled from the template's own
// `verifyQuery` where one exists) is a shortcut for the checkable kind, not
// a verdict on the rest — for those, the Inspector's Archive tab beside this
// desk (what the character actually said) is the real answer, and a GM
// reading the `reason` field is still the enforcement DESIRES.md §8
// describes.

export default function DesireDesk({ desire, onInspect, onClose, registerEscape, onOpenDev }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  useEffect(() => {
    registerEscape?.(() => onClose?.());
    return () => registerEscape?.(null);
  }, [registerEscape, onClose]);

  const reviewed = Boolean(desire.reviewedAt);

  const answer = (fn) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = noteActionVersion(await fn({ desireId: desire.id }));
        if (!res?.ok) {
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        // Not a desk-store patch — a Desire is a Character row, not one of
        // the four types deskRows.js#deskPatchFor knows how to re-read, same
        // reasoning as AvatarReviewRow. The rail's own guarded refresh() is
        // what pulls this row off the queue; this desk just closes over it.
        onClose?.();
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  };

  const reject = async () => {
    if (pending) return;
    const ok = await confirm({
      title: "Reject this claim?",
      message: `Takes ${desire.points} tag point${desire.points === 1 ? "" : "s"} back off ${desire.characterName} and tells them so.`,
      confirmLabel: "Reject",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    answer(rejectDesireClaim);
  };

  // The mini audit log: a search box prefilled from the template's
  // verifyQuery (editable, empty when the template has none), listing that
  // character's audit rows filtered by it.
  const [query, setQuery] = useState(desire.verifyQuery ?? "");
  // Keyed by what was actually asked for, so a fetch landing after the query
  // has already moved on can't paint stale rows under a new search — and so
  // the loading state is DERIVED (this key vs. the current one) rather than
  // reset with a setState at the top of the effect
  // (react-hooks/set-state-in-effect is an error here).
  const sliceKey = `${desire.characterId}:${query}`;
  const [sliceResult, setSliceResult] = useState({ key: null, rows: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCharacterAuditSlice({ characterId: desire.characterId, query });
      if (cancelled) return;
      if (!res?.ok) {
        setSliceResult({ key: sliceKey, rows: null, error: res?.error ?? "Couldn't load the audit trail." });
        return;
      }
      setSliceResult({ key: sliceKey, rows: res.rows, error: null });
    })().catch(() => {
      if (!cancelled) setSliceResult({ key: sliceKey, rows: null, error: "Couldn't load the audit trail." });
    });
    return () => {
      cancelled = true;
    };
  }, [desire.characterId, query, sliceKey]);

  const sliceLoading = sliceResult.key !== sliceKey;
  const sliceError = sliceLoading ? null : sliceResult.error;
  const sliceRows = sliceLoading ? null : sliceResult.rows;

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <CharacterAvatar
              characterId={desire.characterId}
              name={desire.characterName}
              version={desire.avatarVersion}
              catatonic={desire.catatonic}
              size={32}
              zoomable
            />
            <button
              type="button"
              className="desk-name"
              onClick={() => onInspect?.(desire.characterId, desire.characterName)}
            >
              {desire.characterName}
            </button>
          </h2>
          <p className="text-xs text-muted">
            {desire.desireName} · {desire.points} tag point{desire.points === 1 ? "" : "s"}
            {desire.tier != null ? ` (tier ${desire.tier})` : ""} · slot {desire.slotIndex + 1}
            {desire.turnNumber != null ? ` · turn ${desire.turnNumber}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DevCharacterButton
            characterId={desire.characterId}
            name={desire.characterName}
            onOpen={() => onOpenDev?.(desire.characterId, desire.characterName)}
          />
          <button type="button" className="btn-quiet" onClick={onClose} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      <div className="desk-result mt-4 flex flex-col gap-2">
        <span className="field-label">Reason — how they say they earned it</span>
        <p className="text-sm">{desire.reason || "No reason given."}</p>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <label className="field">
          <span className="field-label">Check the audit trail</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
          />
        </label>
        {sliceError && <p className="text-xs form-error">{sliceError}</p>}
        {!sliceError && sliceLoading && <p className="text-xs text-muted">Loading…</p>}
        {!sliceError && !sliceLoading && sliceRows.length === 0 && (
          <p className="text-xs text-muted">Nothing matches — this may be the kind of Desire that leaves no trace. See their Archive tab in the Inspector.</p>
        )}
        {!sliceError && !sliceLoading && sliceRows.length > 0 && (
          <div className="desk-audit-slice">
            {sliceRows.map((entry) => {
              const { familyLabel, segments } = describeAudit(entry);
              return (
                <div key={entry.id} className="text-xs text-muted flex items-start gap-2 py-1">
                  <span className="mono" title={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <span className="flex-1 min-w-0">
                    <AuditSegments entry={entry} segments={segments} />
                  </span>
                  <span className="text-muted">{familyLabel}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FormError>{error}</FormError>

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        {reviewed ? (
          <p className="text-xs text-muted self-center">Already reviewed.</p>
        ) : (
          <>
            <button type="button" className="btn-quiet" disabled={pending} onClick={reject}>
              {pending ? "Working…" : "Reject"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={() => answer(keepDesireClaim)}>
              {pending ? "Working…" : "Keep"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
