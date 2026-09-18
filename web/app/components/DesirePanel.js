"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import InfoIcon from "./InfoIcon";
import RequestDialog from "./RequestDialog";
import RichText from "./RichText";
import DesireRule from "./DesireRule";
import DesireCatalog, { cooldownLabel } from "./DesireCatalog";
import { claimDesire } from "../(app)/character/requestActions";
import { lockedSlotLabel } from "@/lib/desireLabels";

// The one help tooltip, on the heading. It used to be two — flavour text
// here and the rules behind a "How this works" line — and the flavour said
// nothing the catalog doesn't now say for itself.
function desireHelp(desireSlots) {
  return (
    <>
      <p>
        You have {desireSlots} Desire slot{desireSlots === 1 ? "" : "s"}. After fulfilling a Desire,
        that slot is locked temporarily.
      </p>
      <p>Addictions lock your bottom slot to everything except their related desires.</p>
      <p>
        Desires have tiers which determine the amount of points given. Low tier desires can be
        frequently repeated, while high tier desires are once per game.
      </p>
    </>
  );
}

// Body only — the panel chrome lives in GoalsPanel.js, which renders this.
//
// A Desire is claimed retroactively: you did the thing, then you come here and
// say so. So a slot is never "occupied" — it is either open (a Claim button) or
// cooling down from its last claim. Nothing to cancel, nothing in flight.
//
// The bottom slot draws a box around itself when an Addiction binds it, because
// the alternative — a picker that just silently has fewer rows in it — is the
// failure mode describeDesireLocks exists to prevent.
export default function DesirePanel({
  desireSlots = 2,
  slotLockTurns = 2,
  slotStates = [],
  catalog = [],
  families = [],
  familyGroups = [],
  lockNotes = [],
  addiction = null,
}) {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  // Which slot opened the catalog modal, or null. A single shared modal
  // instance rather than one per slot — only one can be open at a time.
  const [catalogSlot, setCatalogSlot] = useState(null);
  // The pick waiting on a reason: { entry, slotIndex }, or null.
  const [claiming, setClaiming] = useState(null);

  const bySlot = new Map(slotStates.map((s) => [s.slotIndex, s]));
  const bottomIndex = desireSlots - 1;
  const openCount = Array.from({ length: desireSlots }, (_, i) => bySlot.get(i)).filter(
    (s) => (s?.lockedUntilTurn ?? null) == null,
  ).length;

  function submitClaim(reason) {
    setError(null);
    startTransition(async () => {
      let res;
      try {
        res = await claimDesire({
          slotIndex: claiming.slotIndex,
          slug: claiming.entry.slug,
          reason,
        });
      } catch {
        // A page left open across a deploy throws here instead of answering; without the catch that took the
        // whole page to the error screen.
        return setError("Could not reach the server. Nothing was changed.");
      }
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setClaiming(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* A real .panel-header now, not a field-label: this is the card's own
          heading, and phase 4 gave every panel heading the bold serif. */}
      <h2 className="panel-header panel-header--with-icon">
        Desires
        <InfoIcon text={desireHelp(desireSlots)} />
        <span className="note text-sm text-muted" style={{ marginLeft: "auto" }}>
          {openCount} open
        </span>
      </h2>

      <div>
        {/* One .desire per slot, the mockup's own grammar (.head + a status
            pill, then the body prose) — the retroactive-claim system this
            game actually runs (Bascinet, 2026-09-18): a slot is never
            "occupied" with a pending reward, only open or cooling down, so
            the pill reads Open / a lock countdown rather than a reward
            figure the mockup's older contract used to show. */}
        {Array.from({ length: desireSlots }, (_, slotIndex) => {
          const slot = bySlot.get(slotIndex) ?? { slotIndex, lockedUntilTurn: null, lastEnded: null };
          const bound = slotIndex === bottomIndex && addiction;
          const locked = slot.lockedUntilTurn != null;
          return (
            <div key={slotIndex} className="desire" data-bound={bound ? "true" : undefined}>
              <div className="head">
                <b>Desire {slotIndex + 1}</b>
                {locked ? (
                  <span className="status-pill" data-tone="warn">
                    {lockedSlotLabel(slot)}
                  </span>
                ) : (
                  <span className="status-pill" data-tone="good">
                    Open
                  </span>
                )}
              </div>
              {slot.lastEnded && (
                <p>
                  <strong>Last:</strong> <RichText text={slot.lastEnded.text} /> — {slot.lastEnded.points} Tag
                  Point{slot.lastEnded.points === 1 ? "" : "s"}
                  {cooldownLabel(slot.lastEnded.template)
                    ? ` · ${cooldownLabel(slot.lastEnded.template)}`
                    : ""}
                </p>
              )}
              {locked ? (
                !slot.lastEnded && <p>{lockedSlotLabel(slot)}</p>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: "var(--sp-1)" }}
                  onClick={() => setCatalogSlot(slotIndex)}
                >
                  Claim a Desire
                </button>
              )}
              {bound && <p className="text-xs text-muted">Addiction: {addiction.name}</p>}
            </div>
          );
        })}
      </div>

      <FormError>{error}</FormError>

      {/* Keyed per opening so search, tab and target slot start fresh each
          time — the component asks for exactly that. */}
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
        slotStates={slotStates}
        catalog={catalog}
        families={families}
        familyGroups={familyGroups}
        lockNotes={lockNotes}
        addiction={addiction}
      />

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
        <DesireRule text={claiming?.entry?.description} className="text-sm" />
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
