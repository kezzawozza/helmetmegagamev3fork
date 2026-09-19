"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import { ChevronDownIcon } from "@/app/components/icons";
import FormError from "@/app/components/FormError";
import RichText from "@/app/components/RichText";
import RequestDialog from "@/app/components/RequestDialog";
import DesireCatalog, { cooldownLabel } from "@/app/components/DesireCatalog";
import { claimDesire } from "@/app/(app)/character/requestActions";
import { desireCatalogView } from "./actions";
import { lockedSlotLabel } from "@/lib/desireLabels";

// The sheet's Desire slots, in the column. Same shape as
// web/app/components/DesirePanel.js and the same claim: a Desire is claimed
// retroactively, so a slot is never occupied — it is open, or cooling down
// from its last claim.
//
// The difference is the catalog. ~271 evaluated templates is a lot to send
// with a page whose Desire block is closed almost every time, so the page
// carries the slots only and the picker fetches the rest of the view the
// first time it is opened (./actions.js#desireCatalogView).
export default function DesiresBlock({ view }) {
  const [refresh] = useRefresh();
  // Open by default, unlike Things: a Claim nobody can see is a Claim nobody
  // makes, and there are only two slots here.
  const [open, setOpen] = useState(true);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  // The evaluated catalog, once somebody has asked for it.
  const [full, setFull] = useState(null);
  const [catalogSlot, setCatalogSlot] = useState(null);
  const [claiming, setClaiming] = useState(null);

  const {
    desireSlots = 2,
    slotStates = [],
    addiction = null,
  } = view ?? {};
  const bySlot = new Map(slotStates.map((s) => [s.slotIndex, s]));
  const bottomIndex = desireSlots - 1;

  function openPicker(slotIndex) {
    setError(null);
    if (full) {
      setCatalogSlot(slotIndex);
      return;
    }
    setLoading(true);
    desireCatalogView()
      .then((res) => {
        setLoading(false);
        if (!res?.ok) return setError(res?.error ?? "Could not load the Desires.");
        setFull(res.view);
        setCatalogSlot(slotIndex);
      })
      .catch(() => {
        setLoading(false);
        setError("Could not reach the server. Nothing was changed.");
      });
  }

  function submitClaim(reason) {
    setError(null);
    startTransition(async () => {
      let res;
      try {
        res = await claimDesire({ slotIndex: claiming.slotIndex, slug: claiming.entry.slug, reason });
      } catch {
        // A page left open across a deploy calls an action the new build doesn't know. That throws, and a throw
        // here took the whole page to the error screen.
        return setError("Could not reach the server. Nothing was changed.");
      }
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setClaiming(null);
      // The slots came down with the page and the catalog's cooldowns just
      // moved, so both are re-read rather than patched.
      setFull(null);
      refresh();
    });
  }

  return (
    <div className="chat-details chat-desires">
      <button
        type="button"
        className="chat-details-fold"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <ChevronDownIcon data-open={open ? "true" : undefined} />
        Desires
      </button>
      {open && (
        <div className="chat-details-body">
          {Array.from({ length: desireSlots }, (_, slotIndex) => {
            const slot = bySlot.get(slotIndex) ?? { slotIndex, lockedUntilTurn: null, lastEnded: null };
            const bound = slotIndex === bottomIndex && addiction;
            return (
              <div key={slotIndex} className="chat-desire-slot">
                <p className="chat-quiet-line">
                  Slot {slotIndex + 1} · {slot.lockedUntilTurn != null ? lockedSlotLabel(slot) : "open"}
                </p>
                {slot.lockedUntilTurn == null && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={loading || pending}
                    onClick={() => openPicker(slotIndex)}
                  >
                    Claim
                  </button>
                )}
                {slot.lastEnded && (
                  <p className="chat-quiet-line chat-desire-note">
                    <strong>Last:</strong> <RichText text={slot.lastEnded.text} /> — {slot.lastEnded.points} Tag Point
                    {slot.lastEnded.points === 1 ? "" : "s"}
                    {cooldownLabel(slot.lastEnded.template) ? ` · ${cooldownLabel(slot.lastEnded.template)}` : ""}
                  </p>
                )}
                {bound && <p className="chat-quiet-line chat-desire-note">Addiction: {addiction.name}</p>}
              </div>
            );
          })}

          <FormError>{error}</FormError>
        </div>
      )}

      {/* Keyed per opening so search, tab and target slot start fresh each
          time — DesireCatalog asks for exactly that. */}
      {full && (
        <DesireCatalog
          key={catalogSlot ?? "closed"}
          open={catalogSlot != null}
          onClose={() => setCatalogSlot(null)}
          onChoose={(pick) => {
            setCatalogSlot(null);
            setClaiming(pick);
          }}
          slotIndex={catalogSlot ?? 0}
          desireSlots={desireSlots}
          slotStates={full.slotStates}
          catalog={full.catalog}
          families={full.families}
          familyGroups={full.familyGroups}
          lockNotes={full.lockNotes}
          addiction={full.addiction}
        />
      )}

      <RequestDialog
        open={Boolean(claiming)}
        title="Claim Desire"
        submitLabel="Claim"
        busy={pending}
        reasonRequired
        onCancel={() => !pending && setClaiming(null)}
        onConfirm={submitClaim}
      >
        <p className="text-sm">
          <RichText text={claiming?.entry?.name} /> — {claiming?.entry?.tier} Tag Point
          {claiming?.entry?.tier === 1 ? "" : "s"}, into slot {(claiming?.slotIndex ?? 0) + 1}
        </p>
        <p className="text-xs text-muted">
          You get the points immediately, but tell the GMs how you pulled it off.
        </p>
        <p className="text-xs text-muted">
          A scene staged only to claim this doesn&apos;t count — write what actually happened.
        </p>
      </RequestDialog>
    </div>
  );
}
