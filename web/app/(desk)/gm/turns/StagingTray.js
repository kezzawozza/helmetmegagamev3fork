"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import FormError from "@/app/components/FormError";
import { StagedEffectRow, StagedMessageRow } from "./StagedItems";
import EffectComposer from "./EffectComposer";
import RoomEffectComposer from "./RoomEffectComposer";
import DeathComposer from "./DeathComposer";
import StagingStrip from "./StagingStrip";
import TransferComposer from "./TransferComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import { retargetMissedStaging } from "./actions";
import { applyDeskPatch } from "./deskStore";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";
import { tagLookup } from "./stagedFormat";

// The bottom tray: everything queued for the push, in one honest list —
// including rows detached from a rejected Move, mass-apply batches, and the
// missed-push banner for rows a resolved turn's push never carried. The
// unattached composers live here too: not every message narrates a Move.

const KIND_FILTERS = [
  { value: "all", label: "All" },
  { value: "effects", label: "Effects" },
  { value: "messages", label: "Messages" },
  { value: "public", label: "Public" },
];

function matchesQuery(needle, ...haystacks) {
  if (!needle) return true;
  return haystacks.some((h) => h && String(h).toLowerCase().includes(needle));
}

// An effect row matches on target, staging GM, or any of its staged tags. A
// room row has no targetName — it matches on the room and its location, and on
// the tags it puts on that floor.
function effectMatches(effect, query, tagsById) {
  const tagLabels = [...(effect.tagOps ?? []), ...(effect.roomTagOps ?? [])].map(
    (t) => tagsById.get(t.tagId)?.name ?? "",
  );
  return matchesQuery(
    query,
    effect.targetName,
    effect.room?.name,
    effect.room?.locationName,
    effect.createdByUsername,
    ...tagLabels,
  );
}

// A message matches on any recipient, its content, the staging GM, or a
// public post's zone.
function messageMatches(message, query) {
  const recipientNames = (message.recipients ?? []).map((r) => r.name);
  return matchesQuery(query, message.content, message.createdByUsername, message.zoneName, ...recipientNames);
}

function batchMatches(group, query, tagsById) {
  return group.some((e) => effectMatches(e, query, tagsById));
}

export default function StagingTray({
  stagedEffects,
  stagedMessages,
  moves,
  roster,
  presenceZones,
  stagingLocations,
  stagingRooms,
  factions,
  tagCatalog,
  onInspect,
  onOpenPreview,
  open,
  setOpen,
  expanded,
  setExpanded,
  revealSignal,
  gmProfiles,
}) {
  const confirm = useConfirm();
  const [composer, setComposer] = useState(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all"); // "all" | "effects" | "messages" | "public"
  const [pending, startTransition] = useTransition();
  const [retargetError, setRetargetError] = useState(null);

  // The interactive push preview's click-through can name a row the tray's
  // own search/kind filter is hiding from an earlier session — the row never
  // mounts and the click silently did nothing. Clearing the filters is a
  // render-time reaction to a new revealSignal (the React-documented pattern
  // for "reset state when a prop changes" — a ref isn't safe to read during
  // render, so the previous token is tracked in state instead), so the row
  // is already in the DOM by the time the scroll effect below runs.
  const [seenRevealToken, setSeenRevealToken] = useState(null);
  if (revealSignal && revealSignal.token !== seenRevealToken) {
    setSeenRevealToken(revealSignal.token);
    if (query) setQuery("");
    if (kindFilter !== "all") setKindFilter("all");
  }

  const tagsById = useMemo(() => tagLookup(tagCatalog), [tagCatalog]);
  const normalizedQuery = query.trim().toLowerCase();

  function toggleExpand() {
    // Sequential, never nested: both setters now write the same
    // sessionStorage-backed object (Workspace's gm-turns-desk), and a
    // setOpen fired from INSIDE setExpanded's updater gets clobbered when
    // the outer read-modify-write completes with its pre-nested snapshot.
    const next = !expanded;
    if (next) setOpen(true);
    setExpanded(next);
  }

  // The interactive push preview's click-through: Workspace flips open+
  // expanded and bumps revealSignal in one go. Any filter clearing the
  // render-time reset above needed has already landed by the time this
  // commits, so the row is in the DOM here. Pure DOM work (scroll + a class
  // toggled off by its own timeout) — no state, so it's safe past the mount
  // that just opened the tray.
  useEffect(() => {
    if (!revealSignal?.id) return undefined;
    const el = document.querySelector(`[data-row-id="${revealSignal.id}"]`);
    if (!el) return undefined;
    el.scrollIntoView({ block: "center" });
    el.classList.add("desk-flash");
    const timeout = setTimeout(() => el.classList.remove("desk-flash"), 1200);
    return () => clearTimeout(timeout);
  }, [revealSignal]);

  const pendingEffects = stagedEffects.filter((e) => !e.applied && !e.missed);
  const pendingPrivate = stagedMessages.filter((m) => !m.sent && !m.missed && m.kind === "PRIVATE");
  const pendingPublic = stagedMessages.filter((m) => !m.sent && !m.missed && m.kind === "PUBLIC");
  const missedEffects = stagedEffects.filter((e) => e.missed);
  const missedMessages = stagedMessages.filter((m) => m.missed);

  const solvedCount = moves.filter((m) => m.reviewStatus === "SOLVED").length;
  const openCount = moves.filter((m) => m.statusLabel === "Open").length;

  // Batches collapse to one line each; singles render as themselves.
  const effectGroups = useMemo(() => {
    const byBatch = new Map();
    const singles = [];
    for (const e of stagedEffects) {
      if (!e.batchId) {
        singles.push(e);
        continue;
      }
      const group = byBatch.get(e.batchId) ?? [];
      group.push(e);
      byBatch.set(e.batchId, group);
    }
    return { batches: [...byBatch.values()], singles };
  }, [stagedEffects]);

  const showEffects = kindFilter === "all" || kindFilter === "effects";
  const showPrivate = kindFilter === "all" || kindFilter === "messages";
  const showPublic = kindFilter === "all" || kindFilter === "public";

  const filteredBatches = showEffects
    ? effectGroups.batches.filter((group) => batchMatches(group, normalizedQuery, tagsById))
    : [];
  const filteredSingles = showEffects
    ? effectGroups.singles.filter((e) => effectMatches(e, normalizedQuery, tagsById))
    : [];
  const filteredMessages = stagedMessages.filter((m) => {
    if (m.kind === "PUBLIC" ? !showPublic : !showPrivate) return false;
    return messageMatches(m, normalizedQuery);
  });

  const totalRows = effectGroups.batches.length + effectGroups.singles.length + stagedMessages.length;
  const shownRows = filteredBatches.length + filteredSingles.length + filteredMessages.length;
  const filtering = Boolean(normalizedQuery) || kindFilter !== "all";

  async function retargetAll() {
    setRetargetError(null);
    const ok = await confirm({
      title: "Carry the missed staging forward?",
      message: `${missedEffects.length + missedMessages.length} row(s) move onto the current turn and go out with the next push.`,
      confirmLabel: "Carry forward",
      cancelLabel: "Leave them",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const res = noteActionVersion(
          await retargetMissedStaging({
            effectIds: missedEffects.map((e) => e.id),
            messageIds: missedMessages.map((m) => m.id),
          }),
        );
        if (!res?.ok) return setRetargetError(res?.error ?? "Something went wrong.");
        applyDeskPatch(res.patch);
      } catch (err) {
        setRetargetError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <section className="desk-tray" data-open={open || undefined} data-expanded={expanded || undefined}>
      <div className="desk-tray-bar">
        <button type="button" className="desk-tray-bar-toggle" onClick={() => setOpen((o) => !o)}>
          <span className="flex flex-wrap items-center gap-3 text-sm">
            <strong>Push tray</strong>
            <span className="mono">{pendingPrivate.length} ✉</span>
            <span className="mono">{pendingEffects.length} effects</span>
            <span className="mono">{pendingPublic.length} public</span>
            <span className="text-muted">
              {solvedCount} solved · {openCount} open{openCount ? " (will close silently)" : ""}
            </span>
            {missedEffects.length + missedMessages.length > 0 && (
              <span className="form-error">
                {missedEffects.length + missedMessages.length} missed last push
              </span>
            )}
          </span>
          {/* A caret, not a worded control. Two worded affordances side by
              side ("▾ hide" and "⤢ Expand") read as a pair of alternatives
              when they are a caret on the bar itself plus one real button. */}
          <span className="text-xs text-muted" aria-hidden="true">{open ? "▾" : "▴"}</span>
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={toggleExpand}
          title={expanded ? "Shrink the tray back into the desk" : "Expand the tray to fill the desk"}
          aria-label={expanded ? "Shrink the tray" : "Expand the tray"}
        >
          {expanded ? "⤡" : "⤢"}
        </button>
      </div>

      {open && (
        <div className="desk-tray-body">
          <div className="flex flex-wrap items-center gap-2">
            <StagingStrip
              onEffect={() => setComposer("effect")}
              onTransfer={() => setComposer("transfer")}
              onRoom={() => setComposer("room")}
              onDeath={() => setComposer("death")}
              onMessage={() => setComposer("message")}
              onPublic={() => setComposer("public")}
            />
            <button type="button" className="btn-quiet" onClick={onOpenPreview}>
              Preview push
            </button>
            {missedEffects.length + missedMessages.length > 0 && (
              <button type="button" className="btn" onClick={retargetAll} disabled={pending}>
                {pending ? "Working…" : "Carry missed rows forward"}
              </button>
            )}
          </div>
          {retargetError && <FormError>{retargetError}</FormError>}

          <div className="flex flex-wrap items-center gap-3">
            <label className="field" style={{ width: "14rem" }}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter staged rows…"
              />
            </label>
            <div className="segmented">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={kindFilter === f.value}
                  onClick={() => setKindFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {filtering && (
              <span className="text-xs text-muted">
                {shownRows} of {totalRows} shown
              </span>
            )}
          </div>

          {filteredBatches.map((group) => (
            <div key={group[0].batchId} className="desk-tray-batch">
              <p className="text-xs text-muted">
                Mass apply · {group.length} targets · {group.map((g) => g.targetName).join(", ")}
              </p>
              <StagedEffectRow
                effect={group[0]}
                tagsById={tagsById}
                tagCatalog={tagCatalog}
                roster={roster}
                presenceZones={presenceZones}
                stagingLocations={stagingLocations}
                stagingRooms={stagingRooms}
                onInspect={onInspect}
                gmProfiles={gmProfiles}
                showBatch
                batchCount={group.length}
              />
            </div>
          ))}
          {filteredSingles.map((e) => (
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
          {filteredMessages.map((m) => (
            <StagedMessageRow
              key={m.id}
              message={m}
              roster={roster}
              presenceZones={presenceZones}
              onInspect={onInspect}
              gmProfiles={gmProfiles}
            />
          ))}
          {stagedEffects.length + stagedMessages.length === 0 && (
            <p className="text-sm text-muted">Nothing staged for this turn yet.</p>
          )}
          {stagedEffects.length + stagedMessages.length > 0 && shownRows === 0 && (
            <p className="text-sm text-muted">Nothing matches that filter.</p>
          )}
        </div>
      )}

      {composer === "effect" && (
        <EffectComposer
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
      {composer === "room" && (
        <RoomEffectComposer
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
          roster={roster}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "transfer" && (
        <TransferComposer
          roster={roster}
          factions={factions}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "message" && (
        <MessageComposer
          roster={roster}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "public" && (
        <PublicComposer
          zones={presenceZones}
          onDone={(patch) => {
            setComposer(null);
            applyDeskPatch(patch);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
    </section>
  );
}
