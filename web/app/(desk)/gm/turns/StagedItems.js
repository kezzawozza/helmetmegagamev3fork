"use client";

import { useMemo, useState, useTransition } from "react";
import StatusPill from "@/app/components/StatusPill";
import { useConfirm } from "@/app/components/ConfirmProvider";
import FormError from "@/app/components/FormError";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EffectComposer from "./EffectComposer";
import RoomEffectComposer from "./RoomEffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import { deleteStagedEffect, deleteStagedMessage, resendStagedMessage } from "./actions";
import { applyDeskPatch } from "./deskStore";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";
import { chunkCount, effectSummary, effectSegments, effectState, effectTargetLabel, deliveryNotes, messageState, tagLookup, truncate } from "./stagedFormat";
import EffectSegments from "./EffectSegments";

// The staged-row lists the desk and the tray share: every row shows what it
// will do at the push, who queued it, and edit/delete — which stay live right
// up until the push freezes the row (sentAt / appliedAt). `data-row-id` is
// how the interactive push preview scrolls a row into view and flashes it
// (Workspace#revealStagedRow).

export function StagedEffectRow({
  effect,
  tagsById,
  tagCatalog,
  roster,
  presenceZones,
  stagingLocations,
  stagingRooms,
  onInspect,
  showBatch,
  batchCount,
  gmProfiles,
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState(null);

  const state = effectState(effect);
  const frozen = effect.applied || Boolean(effect.appliedError);
  // A transfer with no character end — targetCharacterId is null, which can
  // still happen for an old pre-removal faction-to-faction row — has nothing
  // for the row's name/avatar button to open in the inspector. It also isn't
  // editable in place: it's 1:1 by nature, not a fit for EffectComposer's
  // multi-target/multi-field form, so Delete and re-stage stands in for Edit.
  const isTransfer = Boolean(effect.transfer);
  // A room's stash is the other null-target row, and unlike a transfer it IS
  // editable: it is not 1:1 by nature, and RoomEffectComposer is built for it.
  const isRoom = Boolean(effect.room);

  async function onDelete() {
    setDeleteError(null);
    const batch = showBatch && effect.batchId;
    const ok = await confirm({
      title: batch ? "Delete this mass apply?" : "Delete this staged effect?",
      message: batch
        ? `Drops the effect for all ${batchCount ?? "its"} targets — ${effectSummary(effect, tagsById)}.`
        : `${effect.targetName ?? effectTargetLabel(effect)} — ${effectSummary(effect, tagsById)}. It won't apply at the push.`,
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const res = noteActionVersion(await deleteStagedEffect(batch ? { batchId: effect.batchId } : { stagedEffectId: effect.id }));
        if (!res?.ok) return setDeleteError(res?.error ?? "Something went wrong.");
        applyDeskPatch(res.patch);
      } catch (err) {
        setDeleteError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <div className="desk-staged-row" data-kind="effect" data-row-id={effect.id}>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {effect.targetCharacterId ? (
            <button
              type="button"
              className="desk-name inline-flex items-center gap-1"
              onClick={() => onInspect?.(effect.targetCharacterId, effect.targetName)}
            >
              <CharacterAvatar
                characterId={effect.targetCharacterId}
                name={effect.targetName}
                version={effect.targetAvatarVersion}
                size={16}
              />
              {effect.targetName}
            </button>
          ) : (
            <span className="desk-name">{effectTargetLabel(effect)}</span>
          )}{" "}
          <span className="mono">
            <EffectSegments segments={effectSegments(effect, tagsById)} />
          </span>
        </p>
        <p className="desk-staged-sub">
          {showBatch && effect.batchId ? <span>Mass apply</span> : null}
          <span className="inline-flex items-center gap-1">
            <GmAvatar profile={gmProfiles?.[effect.createdByDiscordUserId]} size={13} />
            {effect.createdByUsername}
          </span>
          {effect.turnNumber != null ? <span>turn {effect.turnNumber}</span> : null}
          {effect.appliedError ? <span className="text-danger">{effect.appliedError}</span> : null}
        </p>
        {deleteError && <FormError>{deleteError}</FormError>}
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
        {!frozen && (
          <>
            {!isTransfer && (
              <button type="button" className="btn-quiet" onClick={() => setEditing(true)} disabled={pending}>
                Edit
              </button>
            )}
            <button type="button" className="btn-quiet" onClick={onDelete} disabled={pending}>
              {pending ? "Working…" : "Delete"}
            </button>
          </>
        )}
      </div>
      {editing && isRoom && (
        <RoomEffectComposer
          existing={effect}
          tagCatalog={tagCatalog}
          stagingRooms={stagingRooms}
          onDone={(patch) => {
            setEditing(false);
            applyDeskPatch(patch);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {editing && !isTransfer && !isRoom && (
        <EffectComposer
          existing={effect}
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          onDone={(patch) => {
            setEditing(false);
            applyDeskPatch(patch);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

export function StagedMessageRow({ message, roster, presenceZones, onInspect, gmProfiles }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resendError, setResendError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const state = messageState(message);
  const frozen = message.sent;
  // The push writes DbNull on a clean send, but an empty array would be
  // truthy — check for actual entries rather than presence.
  const failureCount = Array.isArray(message.deliveryFailures) ? message.deliveryFailures.length : 0;
  const deliveryRows = Array.isArray(message.deliveries) ? message.deliveries : [];
  const notes = deliveryNotes(message);
  // A Delivery row that is FAILED is the retryable thing. The blob stays the
  // answer for a message pushed before the table existed.
  const canResend =
    message.sent &&
    (deliveryRows.length ? deliveryRows.some((d) => d.state === "FAILED") : failureCount > 0);

  // Underground there is no summary channel, so a cave declaration posts into
  // every Location channel in the level instead (ADJUDICATION.md §1). Saying
  // "summary channel" there was simply untrue.
  const recipientNames =
    message.kind === "PUBLIC"
      ? message.zoneKind === "CAVE_LEVEL"
        ? `every channel in ${message.zoneName ?? "the caves"}`
        : `the ${message.zoneName ?? "zone's"} summary channel`
      : message.recipients.map((r) => r.name).join(", ") || "nobody";

  async function onDelete() {
    setDeleteError(null);
    const ok = await confirm({
      title: message.kind === "PUBLIC" ? "Delete this public declaration?" : "Delete this staged message?",
      message: `To ${recipientNames}. It won't go out at the push.`,
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const res = noteActionVersion(await deleteStagedMessage({ stagedMessageId: message.id }));
        if (!res?.ok) return setDeleteError(res?.error ?? "Something went wrong.");
        applyDeskPatch(res.patch);
      } catch (err) {
        setDeleteError(mutationErrorMessage(err));
      }
    });
  }

  function onResend() {
    setResendError(null);
    startTransition(async () => {
      try {
        const res = noteActionVersion(await resendStagedMessage({ stagedMessageId: message.id }));
        if (!res?.ok) return setResendError(res?.error ?? "Something went wrong.");
        applyDeskPatch(res.patch);
      } catch (err) {
        setResendError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <div className="desk-staged-row" data-kind={message.kind.toLowerCase()} data-row-id={message.id}>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {message.kind === "PUBLIC" ? (
            <span className="chip">Public{message.zoneName ? ` · ${message.zoneName}` : ""}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {message.recipients.length ? (
                message.recipients.map((r) => (
                  <button
                    key={r.characterId}
                    type="button"
                    className="chip desk-name inline-flex items-center gap-1"
                    onClick={() => onInspect?.(r.characterId, r.name)}
                  >
                    <CharacterAvatar characterId={r.characterId} name={r.name} version={r.avatarVersion} size={16} />
                    {r.name}
                  </button>
                ))
              ) : (
                <span className="chip">no recipients</span>
              )}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm">» {truncate(message.content)}</p>
        {state.tone === "bad" && notes.length > 0 && (
          <ul className="text-xs form-error">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        <p className="desk-staged-sub">
          <span className="inline-flex items-center gap-1">
            <GmAvatar profile={gmProfiles?.[message.createdByDiscordUserId]} size={13} />
            {message.createdByUsername}
          </span>
          {message.turnNumber != null ? <span>turn {message.turnNumber}</span> : null}
          {chunkCount(message.content) > 1 ? <span>{chunkCount(message.content)} msgs</span> : null}
        </p>
        {resendError && <p className="form-error">{resendError}</p>}
        {deleteError && <FormError>{deleteError}</FormError>}
      </div>
      <div className="flex items-center gap-2">
        {/* Delivery detail sits behind the pill rather than under the row.
            A bounce is the exception: it stays spelled out, because it is the
            one thing on a staged row a GM has to act on. */}
        <span title={notes.length ? notes.join("\n") : undefined}>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </span>
        {canResend && (
          <button type="button" className="btn-quiet" onClick={onResend} disabled={pending}>
            {pending ? "Resending…" : "Resend"}
          </button>
        )}
        {!frozen && (
          <>
            <button type="button" className="btn-quiet" onClick={() => setEditing(true)} disabled={pending}>
              Edit
            </button>
            <button type="button" className="btn-quiet" onClick={onDelete} disabled={pending}>
              {pending ? "Working…" : "Delete"}
            </button>
          </>
        )}
      </div>
      {editing &&
        (message.kind === "PUBLIC" ? (
          <PublicComposer
            existing={message}
            zones={presenceZones}
            onDone={(patch) => {
              setEditing(false);
              applyDeskPatch(patch);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <MessageComposer
            existing={message}
            roster={roster}
            onDone={(patch) => {
              setEditing(false);
              applyDeskPatch(patch);
            }}
            onCancel={() => setEditing(false)}
          />
        ))}
    </div>
  );
}

export default function StagedItems({ effects, messages, tagCatalog, roster, presenceZones, stagingLocations, stagingRooms, onInspect, empty, gmProfiles }) {
  const tagsById = useMemo(() => tagLookup(tagCatalog), [tagCatalog]);

  if (!effects.length && !messages.length) {
    return <p className="text-sm text-muted">{empty ?? "Nothing staged."}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {effects.map((e) => (
        <StagedEffectRow
          key={e.id}
          effect={e}
          tagsById={tagsById}
          tagCatalog={tagCatalog}
          roster={roster}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          stagingRooms={stagingRooms}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
        />
      ))}
      {messages.map((m) => (
        <StagedMessageRow
          key={m.id}
          message={m}
          roster={roster}
          presenceZones={presenceZones}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
        />
      ))}
    </div>
  );
}
