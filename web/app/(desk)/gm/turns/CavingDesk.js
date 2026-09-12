"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import EffectComposer from "./EffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import StagingStrip from "./StagingStrip";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { CAVING_KIND_LABELS } from "@/lib/cavingLabels";
import { RESULT_BOX_MAX_LENGTH } from "@/lib/constants";
import { resolveCavingRoll, undoCavingFind } from "./actions";
import { applyDeskPatch } from "./deskStore";
import { clearDeskDraft, deskDraftFresh, useDeskDraft, writeDeskDraft } from "./deskDraft";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";

// The arbitration desk for one Caving Die roll — see
// docs/systemdocs/CAVING.md. Only a TROUBLE (die 1) row is ever unresolved;
// QUIET (2-5) and FIND (6) are stamped resolved the moment the pass writes
// them, so this desk's real job is monsters: narrate what happened, stage
// whatever effects and DMs the encounter needs, and mark it resolved. No
// lock — unlike a Move, two GMs opening the same roll can't race a solve
// that pays anyone twice.
//
// A FIND row opens here too, showing what was found — with no "Mark resolved"
// button, since it has nothing left to resolve, but with its own Undo. The
// loot landed as a PASSED CAVING_LOOT Request and that row still shows in the
// Requests lens; Undo here just saves the GM the trip, and goes through the
// very same undo the Caving lens runs (undoCavingFind in ./actions.js)
// so there is exactly one way the tag ever comes back off.

export default function CavingDesk({
  roll,
  staged,
  tagCatalog,
  roster,
  presenceZones,
  stagingLocations,
  onInspect,
  onClose,
  registerEscape,
  onOpenDev,
  gmProfiles,
  // Read-only mode, for a roll on a pushed turn opened from the History lens —
  // mirrors MoveHistoryDesk: no composers, no Mark resolved, the notes box
  // disabled. Staged rows still show (an unapplied one stays editable).
  readOnly = false,
  turnLabel = null,
}) {
  const confirm = useConfirm();
  // The Result box, held outside this component so a reload or anything else
  // that replaces the column hands it back (deskDraft.js) — the same
  // treatment MoveDesk.js gives its own.
  const draftKey = `caving:${roll.id}`;
  const draft = useDeskDraft(draftKey);
  const gmNotes = draft?.gmNotes ?? roll.gmNotes ?? "";
  // A cold draft is still guarded on close and on unload; it just stops
  // standing the desk's backstop poll down (useDirtyGuard, deskDraft.js).
  const { markDirty, markClean, guardedClose } = useDirtyGuard({
    alsoDirty: !!draft,
    alsoDirtyHoldsPoll: deskDraftFresh(draftKey),
  });

  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const [composer, setComposer] = useState(null); // "effect" | "message" | "public" | null
  // Set only by "Stage as message" below, to prefill the composer with the
  // Result box's narration — the same bridge MoveDesk.js uses. A plain
  // "+ Message" clears it first, so it opens empty.
  const [messagePrefill, setMessagePrefill] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const setNotes = useCallback(
    (value) => {
      markDirty();
      writeDeskDraft(draftKey, { gmNotes: value });
    },
    [markDirty, draftKey],
  );

  // mode: "save" keeps the Result text where it is, "resolve" stamps the roll.
  function run(mode) {
    setError(null);
    startTransition(async () => {
      try {
        const res = noteActionVersion(await resolveCavingRoll({ cavingRollId: roll.id, gmNotes, mode }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        clearDeskDraft(draftKey);
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  // Taking the find back. The roll stands; only the loot comes off. Guarded
  // by CavingRoll.lootUndoneAt server-side, so a double-click drops nothing
  // twice.
  async function undoFind() {
    setError(null);
    const ok = await confirm({
      title: `Take back ${roll.lootTagName ?? "this find"}?`,
      message: `${roll.characterName} keeps the roll — only the loot comes off the sheet.`,
      confirmLabel: "Take it back",
      cancelLabel: "Leave it",
    });
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = noteActionVersion(await undoCavingFind({ rollId: roll.id }));
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        // Same as resolve() above: GM notes typed but never marked clean
        // would otherwise leave isAnyDirty() stuck true for the rest of the
        // session, silently pausing the desk's 45s poll.
        markClean();
        applyDeskPatch(res.patch);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <CharacterAvatar characterId={roll.characterId} name={roll.characterName} version={roll.avatarVersion} size={32} zoomable />
            <button type="button" className="desk-name" onClick={() => onInspect(roll.characterId, roll.characterName)}>
              {roll.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({roll.discordUsername})</span>
          </h2>
          <p className="text-xs text-muted">
            {roll.roleTitle && <>{roll.roleTitle} · </>}
            {roll.locationName ? <>{roll.locationName} · </> : null}
            {roll.zoneName} · ⚀ {roll.die} · {roll.kindLabel ?? CAVING_KIND_LABELS[roll.kind] ?? roll.kind}
            {readOnly && turnLabel ? <> · {turnLabel}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DevCharacterButton
            characterId={roll.characterId}
            name={roll.characterName}
            onOpen={() => onOpenDev?.(roll.characterId, roll.characterName)}
          />
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      {roll.kind === "FIND" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm">
            Rolled a {roll.die} and found <strong>{roll.lootTagName ?? "—"}</strong> ({roll.lootTier ?? "—"}).{" "}
            {roll.lootUndoneAt
              ? "That find was taken back — the tag is off the sheet."
              : roll.lootTagId
                ? "Already on their sheet."
                : "Already granted, but the tag is no longer on record — take it off by hand from the Dev Panel."}
          </p>
          {roll.lootTagId && !roll.lootUndoneAt && (
            <button type="button" className="btn-quiet" onClick={undoFind} disabled={pending}>
              {pending ? "Working…" : "Undo this find"}
            </button>
          )}
        </div>
      )}

      {roll.kind === "TROUBLE" && (
        <div className="desk-result mt-4 flex flex-col gap-3">
          <label className="field">
            <span className="field-label">Result — what happened down there</span>
            <textarea
              rows={4}
              maxLength={RESULT_BOX_MAX_LENGTH}
              value={gmNotes}
              disabled={pending || readOnly}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What actually happened here. GM-facing — send it to the player with Stage as message."
            />
          </label>
          {!readOnly && (
            <button
              type="button"
              className="btn-quiet self-start"
              disabled={!gmNotes.trim()}
              onClick={() => {
                setMessagePrefill(gmNotes);
                setComposer("message");
              }}
            >
              Stage as message
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this roll</h3>
          {!readOnly && (
            <StagingStrip
              onEffect={() => setComposer("effect")}
              onMessage={() => {
                setMessagePrefill(null);
                setComposer("message");
              }}
              onPublic={() => setComposer("public")}
            />
          )}
        </div>

        <StagedItems
          effects={staged.effects}
          messages={staged.messages}
          tagCatalog={tagCatalog}
          roster={roster}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
          empty="Nothing staged yet."
        />
      </div>

      {composer === "effect" && (
        <EffectComposer
          cavingRollId={roll.id}
          defaultTarget={{ id: roll.characterId, name: roll.characterName }}
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
          cavingRollId={roll.id}
          defaultRecipients={[{ characterId: roll.characterId, name: roll.characterName }]}
          initialContent={messagePrefill ?? undefined}
          initialRecipients={messagePrefill != null ? [{ characterId: roll.characterId, name: roll.characterName }] : undefined}
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
          cavingRollId={roll.id}
          zones={presenceZones}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {!roll.resolvedByUsername && roll.autoResolved && (
        <p className="text-xs text-muted">
          Resolved automatically at the push{roll.resolvedAtLabel ? ` · ${roll.resolvedAtLabel}` : ""} — nobody
          adjudicated it, and the hold on leaving the zone lifted.
        </p>
      )}
      {roll.resolvedByUsername && (
        <p className="mt-3 text-xs text-muted">
          Resolved by {roll.resolvedByUsername}
          {roll.resolvedAtLabel ? ` · ${roll.resolvedAtLabel}` : ""}
        </p>
      )}

      <FormError>{error}</FormError>

      {roll.kind === "TROUBLE" && !readOnly && (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          {/* Save is always here, resolved or not — the same fix MoveDesk.js:415
              describes. Marking a roll resolved used to take the only button
              that wrote the Result box away with it, so the box stayed typeable
              and threw away everything typed into it after that. */}
          <button type="button" className="btn-quiet" onClick={() => run("save")} disabled={pending}>
            {pending ? "Working…" : "Save"}
          </button>
          {!roll.resolvedAt && (
            <button type="button" className="btn" onClick={() => run("resolve")} disabled={pending}>
              {pending ? "Working…" : "Mark resolved"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
