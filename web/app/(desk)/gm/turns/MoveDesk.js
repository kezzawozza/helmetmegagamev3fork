"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FormError from "@/app/components/FormError";
import TagChip from "@/app/components/TagChip";
import CombatTile from "@/app/components/CombatReadout";
import Tooltip from "@/app/components/Tooltip";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import DeskRowMenu from "@/app/components/DeskRowMenu";
import { prefetchDevPanel } from "@/app/components/DevPanelModal";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import useMoveLock from "./useMoveLock";
import EffectComposer from "./EffectComposer";
import RoomEffectComposer from "./RoomEffectComposer";
import DeathComposer from "./DeathComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import StagingStrip from "./StagingStrip";
import { resolveMove, rejectMove } from "./actions";
import { applyDeskPatch } from "./deskStore";
import { clearDeskDraft, deskDraftFresh, useDeskDraft, writeDeskDraft } from "./deskDraft";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";
import { RESULT_BOX_MAX_LENGTH } from "@/lib/constants";
import { stagingReaches } from "@/lib/stagingReach";

// The arbitration desk for one Move. Everything a GM does here STAGES: the
// Result box is the canon of what happened (GM-facing, one field — gmNotes
// carries machine markers only and never renders), the composers queue
// messages and effects, and Solve marks the staging complete. Nothing
// touches the player until the turn-end push. The two exceptions are Reject
// (deletes the Move, frees the turn, tells them now) and the lock this desk
// claims so two GMs don't work the same row.

const REJECT_HELP =
  "Deletes the Move and frees up their turn — the misclick escape hatch, or a Move that shouldn't have been one. They're told right away, and anything staged on it stays, detached, in the tray.";

function Switch({ label, value, options, onChange, disabled, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label flex items-center gap-1.5">
        {label}
        {children}
      </span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MoveDesk({
  move,
  staged,
  tagsById,
  tagCatalog,
  roster,
  presenceZones,
  stagingLocations,
  stagingRooms,
  currentTurnNumber,
  onInspect,
  onClose,
  registerEscape,
  onOpenDev,
  gmProfiles,
}) {
  const router = useRouter();
  // The Result box and the Kind switch, held outside this component so they
  // survive anything that replaces it — a reload included (deskDraft.js).
  // The draft wins while it exists; a save, a solve or a reject clears it and
  // the saved row takes back over.
  const draftKey = `move:${move.id}`;
  const draft = useDeskDraft(draftKey);
  const edits = useMemo(
    () => draft ?? { moveKind: move.moveKind, resultMessage: move.resultMessage ?? "" },
    [draft, move.moveKind, move.resultMessage],
  );
  // A cold draft is still guarded on close and on unload; it just stops
  // standing the desk's backstop poll down (useDirtyGuard, deskDraft.js).
  const { markDirty, markClean, guardedClose } = useDirtyGuard({
    alsoDirty: !!draft,
    alsoDirtyHoldsPoll: deskDraftFresh(draftKey),
  });
  const confirm = useConfirm();
  const { locked, error: lockError } = useMoveLock(move.id);

  // The workspace's layered Escape deselects through the same dirty guard
  // as the Close button.
  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const [composer, setComposer] = useState(null); // "effect" | "message" | "public" | null
  // Set only by "Stage as message" below, to prefill the composer with the
  // LOCAL (possibly unsaved) Result text. The plain "+ Message" button
  // leaves this null, so the composer opens blank as before.
  const [messagePrefill, setMessagePrefill] = useState(null);
  const [error, setError] = useState(null);
  // Which face the Combat tile is showing. Same swap-in-place behaviour as the
  // sheet and the inspector — one component, three surfaces.
  const [combatOpen, setCombatOpen] = useState(false);
  // The desk ships tag rows keyed by id and the tag bodies in one shared map
  // (moveRows.js#tagsByIdFor), so they have to be joined back up before
  // anything can resolve a band off them. `equipped` rides the row, not the
  // tag — a stowed sword is a different character in a fight than a drawn one.
  const combatTags = useMemo(
    () =>
      (move.tags ?? [])
        .map((t) => (tagsById[t.tagId] ? { ...t, tag: tagsById[t.tagId] } : null))
        .filter(Boolean),
    [move.tags, tagsById],
  );
  const [pending, startTransition] = useTransition();

  // Read off the enum, not the display label — a live lock never masks this
  // any more (moveRows.js), but the enum is still the one thing that can't
  // drift if the label's wording ever does.
  const solved = move.reviewStatus === "SOLVED";
  const disabled = pending || !locked;

  // Somebody else solved this Move while a draft sat on it. The row is done,
  // so the draft is not unsaved work any more — it is stale narration sitting
  // on top of a closed card, and leaving it there would show the GM their own
  // half-sentence over a Solved badge and go on claiming the desk is dirty.
  // Dropping it hands the editor back the saved values, which is what a Solve
  // by this GM does too.
  useEffect(() => {
    if (solved && draft) clearDeskDraft(draftKey);
  }, [solved, draft, draftKey]);

  const setEdit = useCallback(
    (key, value) => {
      markDirty();
      writeDeskDraft(draftKey, { ...edits, [key]: value });
    },
    [markDirty, draftKey, edits],
  );

  // Solving is the last moment anyone looks at this Move, and the Result box
  // is GM-facing — it is never sent. A Move whose outcome lives only there
  // reaches its player as silence, and for a Gambit that silence is total
  // (Gambits are excluded from the passed-Routine fallback DM). So say so
  // before the GM walks away from it.
  async function run(mode) {
    setError(null);
    if (
      mode === "solve" &&
      edits.resultMessage.trim() &&
      !stagingReaches(move.characterId, staged)
    ) {
      const ok = await confirm({
        title: `Nothing you've staged reaches ${move.characterName}`,
        message:
          "The Result box is GM-facing and is never sent. Stage it as a message first, or solve anyway if they hear about this another way.",
        confirmLabel: "Solve anyway",
        cancelLabel: "Back to staging",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const res = noteActionVersion(await resolveMove({ actionId: move.id, mode, edits }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        clearDeskDraft(draftKey);
        // The row on screen changes because the write happened, not because a
        // page refetch came back (deskStore.js). This is the fix for a Solve
        // that saved and left the desk still offering Solve.
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  function submitReject() {
    setError(null);
    startTransition(async () => {
      try {
        const res = noteActionVersion(await rejectMove({ actionId: move.id }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        clearDeskDraft(draftKey);
        if (res.deliveryFailed) {
          setError("Move rejected — but they weren't told. Let them know they can act again.");
        } else {
          onClose();
        }
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  // "rolled 5–12 ⬢ → +8", built server-side with the rest of the DTO
  // (web/lib/moveRows.js) so the history desk reads the same string.
  const declared = move.declaredLabel;

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <CharacterAvatar characterId={move.characterId} name={move.characterName} version={move.avatarVersion} size={32} zoomable />
            <button type="button" className="desk-name" onClick={() => onInspect(move.characterId, move.characterName)}>
              {move.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({move.discordUsername})</span>
          </h2>
          <p className="text-xs text-muted">
            {move.roleTitle && <>{move.roleTitle} · </>}
            {move.locationLabel} · {move.factionName || "No faction"} · {move.resources} ⬢ on hand
          </p>
          {move.standingHere?.length ? (
            <p className="text-xs text-muted">Standing here: {move.standingHere.join(" · ")}</p>
          ) : null}
        </div>
        {/* Four quiet buttons of equal weight left nothing in this header
            reading as the way out. The side trips go behind ⋯; Close stays a
            real button, because it is the one a GM reaches for. */}
        <div className="flex items-center gap-2">
          <DeskRowMenu
            ariaLabel={`More for ${move.characterName}`}
            onOpen={() => prefetchDevPanel(move.characterId)}
            items={[
              // Straight to their conversation on the player desk. The
              // reverse link lives on that desk's Canon tab, so the two are
              // one loop.
              move.discordUserId && {
                label: "Message them →",
                onClick: () => guardedClose(() => router.push(`/gm/players/${move.discordUserId}`)),
              },
              // Everything they did before this turn, in the inspector's
              // Moves tab — "what did this person do last time" without
              // leaving the row you're adjudicating.
              {
                label: "Past moves",
                onClick: () => onInspect(move.characterId, move.characterName, "Moves"),
              },
              {
                label: "Open dev panel",
                onClick: () => onOpenDev?.(move.characterId, move.characterName),
              },
            ]}
          />
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      {/* How hard does this person hit, and what happens when they are hit —
          the two questions an arbitration opens with, which this panel used to
          answer by sending the GM off to the right-hand inspector. Same tile,
          same breakdown on hover, plus the armour pieces a GM gets and a
          player does not (COMBAT.md §2). */}
      <div className="mt-3 flex">
        <CombatTile tags={combatTags} showArmorPieces open={combatOpen} onOpen={setCombatOpen} />
      </div>

      {move.tags?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {move.tags.map((t) =>
            tagsById[t.tagId] ? (
              <TagChip
                key={t.tagId}
                tag={tagsById[t.tagId]}
                quantity={t.quantity}
                expiresTurn={t.expiresTurn}
                currentTurn={currentTurnNumber}
              />
            ) : null,
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <blockquote className="desk-move-text">» {move.description}</blockquote>
        <div className="flex flex-wrap items-end gap-4">
          {move.isTravel ? (
            <div className="flex flex-col gap-1">
              <span className="field-label">Kind</span>
              <span className="text-sm text-muted">Travel — auto-filed, no Routine/Gambit to pick</span>
            </div>
          ) : (
            <Switch
              label="Kind"
              value={edits.moveKind}
              disabled={disabled}
              onChange={(v) => setEdit("moveKind", v)}
              options={[
                { value: "ROUTINE", label: "Routine" },
                { value: "GAMBIT", label: "Gambit" },
                { value: "LABOR", label: "Labor" },
              ]}
            />
          )}
          <div className="flex flex-col gap-1">
            <span className="field-label">Dice</span>
            {/* A player's Gambit is not rolled until Moves lock (db/lib/gambitCutoff.js),
                so an empty one before the cutoff is waiting, not missing. Working the desk
                after the lock is the intended order (ADJUDICATION.md), but a GM who opens
                it early should not read "—" as a broken row. */}
            <span className="mono text-sm">
              {move.rollLabel ||
                (move.moveKind === "GAMBIT" && move.confirmed ? "rolls at lock-in" : "—")}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="field-label">Declared</span>
            <span className="mono text-sm">{declared ?? "—"}</span>
          </div>
        </div>
        {/* Always rendered, empty or not. Switching Kind used to make this
            line appear from nowhere and shove the Result box down the screen
            mid-sentence; reserving the two lines it can take costs a little
            whitespace and costs nobody their place. */}
        <p className="desk-kind-note text-xs text-accent" aria-live="polite">
          {edits.moveKind === move.moveKind
            ? ""
            : edits.moveKind === "GAMBIT"
              ? "Saving rolls a fresh d6 and applies their current Hunger."
              : edits.moveKind === "LABOR"
                ? "Saving clears the roll. A Labor is never arbitrated — its payout came from the range already on it."
                : "Saving clears the roll — a Routine never carries one."}
        </p>
        {declared && (
          <p className="text-xs text-muted">
            Declared numbers pay out at the push whether or not you Solve. Disagree? Stage an
            offsetting effect below.
          </p>
        )}
      </div>

      {/* The job. Five identical border-t slabs down this card left the one
          box a GM is actually here to fill in looking like the four around
          it, so this one is a raised panel with the accent edge instead of a
          fifth hairline. */}
      <div className="desk-result mt-4 flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Result — the canon of what happened</span>
          <textarea
            rows={4}
            value={edits.resultMessage}
            disabled={disabled}
            maxLength={RESULT_BOX_MAX_LENGTH}
            onChange={(e) => setEdit("resultMessage", e.target.value)}
            placeholder="What actually happened here. GM-facing — tell the players with staged messages below."
          />
        </label>
        <button
          type="button"
          className="btn-quiet self-start"
          disabled={!edits.resultMessage.trim()}
          onClick={() => {
            setMessagePrefill(edits.resultMessage);
            setComposer("message");
          }}
        >
          Stage as message
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this Move</h3>
          <StagingStrip
            onEffect={() => setComposer("effect")}
            onRoom={() => setComposer("room")}
            onDeath={() => setComposer("death")}
            onMessage={() => {
              setMessagePrefill(null);
              setComposer("message");
            }}
            onPublic={() => setComposer("public")}
          />
        </div>

        <StagedItems
          effects={staged.effects}
          messages={staged.messages}
          tagCatalog={tagCatalog}
          roster={roster}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          stagingRooms={stagingRooms}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
          empty="Nothing staged yet."
        />
      </div>

      {composer === "room" && (
        <RoomEffectComposer
          moveId={move.id}
          tagCatalog={tagCatalog}
          stagingRooms={stagingRooms}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "death" && (
        <DeathComposer
          moveId={move.id}
          defaultTarget={{ id: move.characterId, name: move.characterName }}
          roster={roster}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "effect" && (
        <EffectComposer
          moveId={move.id}
          defaultTarget={{ id: move.characterId, name: move.characterName }}
          declaredDelta={move.resourceDelta ?? null}
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "message" && (
        <MessageComposer
          moveId={move.id}
          defaultRecipients={[{ characterId: move.characterId, name: move.characterName }]}
          initialContent={messagePrefill ?? undefined}
          initialRecipients={messagePrefill != null ? [{ characterId: move.characterId, name: move.characterName }] : undefined}
          roster={roster}
          onDone={(patch) => {
            setComposer(null);
            setMessagePrefill(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => {
            setComposer(null);
            setMessagePrefill(null);
          }}
        />
      )}
      {composer === "public" && (
        <PublicComposer
          moveId={move.id}
          defaultZoneId={move.zoneId}
          zones={presenceZones}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {move.reviewedByUsername && (
        <p className="mt-3 flex items-center gap-1 text-xs text-muted">
          <GmAvatar profile={gmProfiles?.[move.reviewedByDiscordUserId]} size={13} />
          Solved by {move.reviewedByUsername}
          {move.reviewedAtLabel ? ` · ${move.reviewedAtLabel}` : ""}
        </p>
      )}

      {!locked && !lockError && <p className="mt-3 text-xs text-muted">Claiming this Move…</p>}
      <FormError>{error ?? lockError}</FormError>

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <Tooltip text={REJECT_HELP}>
          <button
            type="button"
            className="btn-danger"
            onClick={submitReject}
            disabled={disabled}
          >
            Reject
          </button>
        </Tooltip>

        {/* Save is always here — a solved Move stays freely editable, since
            the status guard it used to sit behind protected nothing (Solve is
            bookkeeping; nothing pays until the push). That's what stranded
            last night's edit: Save refused to touch a Solved row, and the
            only way out was Reopen, which the desk's own lock-masked status
            was hiding the button for. */}
        <button type="button" className="btn-quiet" onClick={() => run("save")} disabled={disabled}>
          {pending ? "Working…" : "Save"}
        </button>
        {solved ? (
          <Tooltip text="Puts the Move back in the queue. Nothing staged is lost.">
            <button type="button" className="btn" onClick={() => run("unsolve")} disabled={disabled}>
              {pending ? "Working…" : "Reopen"}
            </button>
          </Tooltip>
        ) : (
          <Tooltip text="Marks the staging complete. Nothing applies until the push.">
            <button type="button" className="btn" onClick={() => run("solve")} disabled={disabled}>
              {pending ? "Working…" : "Solve"}
            </button>
          </Tooltip>
        )}
      </div>

    </div>
  );
}
