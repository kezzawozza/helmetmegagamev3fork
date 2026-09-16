"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import CheckField from "@/app/components/CheckField";
import StatusPill from "@/app/components/StatusPill";
import Select from "@/app/components/Select";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import { useTableState } from "@/app/components/DataTable";
import useSessionState, { readSession, writeSession } from "@/app/components/useSessionState";
import { useIsCoarsePointer } from "@/app/components/useIsCoarsePointer";
import { isFieldFocused, hasModifier } from "@/lib/deskKeyGuard";
import { MOVE_REVIEW_TONES, MOVE_REVIEW_LABELS } from "@/lib/moves";
import { dialogHoldsKeyboard } from "@/app/components/Modal";
import { inVisibleZones } from "@/lib/zones";
import { useVisibleZoneNames } from "@/app/components/GmZoneViewProvider";
import IconButton from "@/app/components/IconButton";
import MatchHint from "@/app/components/MatchHint";
import { CheckIcon, CloseIcon } from "@/app/components/icons";
import { useRefresh } from "@/app/components/useRefresh";
import { cancelHoldAsGm, keepAvatar, rejectAvatar, keepDesireClaim, rejectDesireClaim } from "./actions";
import { mutationErrorMessage, noteActionVersion } from "@/app/components/useDeskVersion";
import { useConfirm } from "@/app/components/ConfirmProvider";

// The left rail: the work queue as a compact list, using useTableState (the
// same filter/search/sort engine every table uses) minus the table markup.

// Fixed vocabularies for the enum-backed dropdowns, so a value always shows
// even at a count of zero. WAITING_FOR_OPPONENTS/IN_PROGRESS are dropped —
// neither is a status the mapper produces (moveRows.js#moveStatusLabel).
const MOVE_KIND_OPTIONS = ["Routine", "Gambit", "Travel"];
const MOVE_STATUS_OPTIONS = Object.values(MOVE_REVIEW_LABELS).filter(
  (l) => l !== "Waiting for Opponents" && l !== "In Progress",
);

// Open work floats to the top; Solved/Passed sink. Ties fall back to
// recency — see queueOrder below.
const MOVE_STATUS_RANK = { Open: 0, "Waiting for Opponents": 0, Solved: 1, Passed: 2 };
// Same trick for the Caving lens — see rankedMoves below.
const CAVING_STATUS_RANK = { "Needs attention": 0, Resolved: 1 };
const CAVING_STATUS_OPTIONS = ["Needs attention", "Resolved"];

const MOVE_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.factionZoneName },
  { key: "kind", label: "Kind", value: (r) => r.kindLabel, options: MOVE_KIND_OPTIONS },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: MOVE_STATUS_OPTIONS },
];
// scoreMatch fields (web/lib/fuzzySearch.js). `tags` only carries tagIds, so
// tag name search needs the catalog lookup, hence the factory.
function makeMoveSearchMap(tagsById) {
  return (r) => ({
    name: r.characterName,
    username: r.discordUsername,
    role: r.roleTitle,
    faction: r.factionName,
    zone: `${r.factionZoneName ?? ""} ${r.locationLabel ?? ""}`,
    tag: (r.tags ?? []).map((t) => tagsById?.[t.tagId]?.name ?? "").join(" "),
    kind: r.kindLabel,
    status: r.statusLabel,
    text: r.description,
    notes: [r.resultMessage, r.gmNotes].filter(Boolean).join(" "),
  });
}


// One sessionStorage key for the CLICK-frequency rail VIEW state — a reload
// restores it. Workspace.js reads the same key for `lens`.
export const RAIL_STORAGE_KEY = "gm-turns-rail";
export const RAIL_STORAGE_DEFAULT = {
  lens: "moves",
  filters: {}, // { moves, caving, other, desires, ooc, history, "history-caving" } — each an initialFilters-shaped object
  hideTravel: true,
  hideHistoryTravel: true,
  historyKind: "moves", // "moves" | "caving"
};

// KEYSTROKE/SCROLL-frequency state lives under a key nothing subscribes to
// (useSessionState.js#readSession/#writeSession), so writing it can't wake
// this component. Debounced, with a pagehide flush for the tail.
const VIEW_STORAGE_KEY = "gm-turns-view";
const VIEW_STORAGE_DEFAULT = { query: {}, scroll: {} };

// Read-merge-write so the query writer and the scroll writer never clobber
// each other's half of the key.
function mergeView(patch) {
  const current = readSession(VIEW_STORAGE_KEY, VIEW_STORAGE_DEFAULT) ?? VIEW_STORAGE_DEFAULT;
  writeSession(VIEW_STORAGE_KEY, {
    ...current,
    ...(patch.query ? { query: { ...current.query, ...patch.query } } : null),
    ...(patch.scroll ? { scroll: { ...current.scroll, ...patch.scroll } } : null),
  });
}

// Hydration signal: false on the server and during the hydration render
// (where storage-derived state would mismatch server HTML), true after.
const subscribeNever = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

// The Caving lens — see docs/systemdocs/CAVING.md. Only a TROUBLE row is
// ever "Needs attention"; every roll shows by default, unresolved TROUBLE
// just ranks first.
const CAVING_FILTER_DEFS = [
  // The zone the die rolled in, not the roller's faction seat — see
  // cavingRollRow in web/lib/moveRows.js.
  { key: "zone", label: "Zone", value: (r) => r.zoneName },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: CAVING_STATUS_OPTIONS },
];
const cavingSearchMap = (r) => ({
  name: r.characterName,
  username: r.discordUsername,
  role: r.roleTitle,
  faction: r.factionName,
  zone: r.zoneName,
  kind: r.kindLabel,
  status: r.statusLabel,
  tag: r.lootTagName,
});
const CAVING_TONES = { "Needs attention": "bad", Resolved: "neutral" };

// The Desires lens — fulfilled, catalog-backed claims waiting on a GM
// (docs/systemdocs/DESIRES.md §6). Unreviewed sorts first; a reviewed row
// stays in the list, dimmed, rather than dropping out.
const DESIRE_STATUS_OPTIONS = ["Waiting", "Reviewed"];
const DESIRE_STATUS_RANK = { Waiting: 0, Reviewed: 1 };
const DESIRE_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.zoneName },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: DESIRE_STATUS_OPTIONS },
];
const desireSearchMap = (r) => ({
  name: r.characterName,
  desire: r.desireName,
  zone: r.zoneName,
  status: r.statusLabel,
  text: r.reason,
});

// The Other lens — everything holding somebody in place this turn
// (docs/systemdocs/ATTACK.md). Attacks, ambushes and Safe intercepts in one
// list, because to a GM reading the queue they are one question: who cannot
// leave, and who is standing over them.
//
// The lens is deliberately named for the shape rather than the contents. It is
// where the next thing that is neither a Move nor a die goes.
const OTHER_KIND_OPTIONS = ["Attack", "Ambush", "Intercept", "Portrait"];
const OTHER_STATUS_OPTIONS = ["Holding", "Called off", "Stopped", "New"];
// New sorts with Holding, at the top: a picture waiting on a GM is the one
// kind of Other row that is asking to be DONE rather than read.
const OTHER_STATUS_RANK = { Holding: 0, New: 0, Stopped: 1, "Called off": 2 };
const OTHER_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.zoneName },
  { key: "kind", label: "Kind", value: (r) => r.kindLabel, options: OTHER_KIND_OPTIONS },
  { key: "status", label: "Status", value: (r) => r.statusLabel, options: OTHER_STATUS_OPTIONS },
];
const otherSearchMap = (r) => ({
  name: r.characterName,
  target: r.targetName,
  // Everybody in the fight, not only the two the title names — searching a
  // brawl for the third person in it should find it.
  people: r.searchText,
  username: r.discordUsername,
  role: r.roleTitle,
  zone: `${r.zoneName ?? ""} ${r.locationName ?? ""}`,
  kind: r.kindLabel,
  status: r.statusLabel,
});
// A live hold is the only one a GM can still do anything about.
const OTHER_TONES = { Holding: "bad", New: "warn", Stopped: "neutral", "Called off": "neutral" };

// The OOC lens. No status and no kind — a line was said or it was not — so
// the only axis left to narrow by is where it was said.
const OOC_FILTER_DEFS = [
  { key: "zone", label: "Zone", value: (r) => r.zoneName },
  { key: "place", label: "Place", value: (r) => r.placeName },
];
const oocSearchMap = (r) => ({
  name: r.characterName,
  username: r.discordUsername,
  // The words themselves, which is what a GM chasing "who said that" has.
  text: r.text,
  zone: `${r.zoneName ?? ""} ${r.placeName ?? ""}`,
});

// The keyboard lens flips, and what ⏎ selects in each lens. The History
// lens over the OPEN turn selects a live "move" — see historyIsOpenTurn.
const LENS_FOR_KEY = { m: "moves", c: "caving", o: "other", h: "history", d: "desires" };
const SELECTION_TYPE_FOR_LENS = {
  moves: "move",
  caving: "caving",
  history: "history",
  desires: "desire",
  ooc: "ooc",
};

function RailFilters({ table, filterDefs, searchPlaceholder, header, children }) {
  return (
    // Two bands, not five. The search line carries the quiet extras
    // (the travel checkbox) beside it, and every dropdown shares the second —
    // a rail that opened with four stacked rows of chrome before its first
    // row of work was a rail nobody could see the work in.
    <div className="desk-rail-filters">
      {header}
      <div className="desk-rail-filter-line">
        <label className="field min-w-0" style={{ flex: "1 1 9rem" }}>
          <span className="field-label">Search</span>
          <input
            value={table.query}
            onChange={(e) => table.setQuery(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        {children}
      </div>
      <div className="desk-rail-filter-line">
        {filterDefs.map((def) => (
          <label className="field min-w-0" style={{ flex: "1 1 6rem" }} key={def.key}>
            <span className="field-label">{def.label}</span>
            <Select
              value={table.filters[def.key] ?? ""}
              onChange={(e) => table.setFilters((f) => ({ ...f, [def.key]: e.target.value }))}
            >
              <option value="">All</option>
              {table.options[def.key]?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
    </div>
  );
}

// `type` and `lensKey` are what let the History lens reuse this: identical
// rows, a different selection type and keyboard lens.
function MoveRows({
  rows,
  matchFor,
  stagedByMove,
  selected,
  onSelect,
  gmProfiles,
  kbdId,
  kbdLens,
  type = "move",
  lensKey = "moves",
}) {
  return rows.map((row) => {
    const staged = stagedByMove.get(row.id);
    const stagedCount = (staged?.effects.length ?? 0) + (staged?.messages.length ?? 0);
    const active = selected?.type === type && selected.id === row.id;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        data-auto={row.isTravel || undefined}
        data-kbd={kbdLens === lensKey && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type, id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} catatonic={row.catatonic} />
            <span className="truncate">{row.characterName}</span>
            <MatchHint match={matchFor(row)} />
          </span>
          <span className="flex items-center gap-1.5">
            {row.lockedByDiscordUserId && <GmAvatar profile={gmProfiles?.[row.lockedByDiscordUserId]} size={14} />}
            <StatusPill tone={MOVE_REVIEW_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
          </span>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.kindLabel}
          {row.rollLabel ? ` · ${row.rollLabel}` : ""}
          {stagedCount ? ` · ${stagedCount} staged` : ""}
        </span>
        <span className="block truncate text-xs text-muted">{row.description}</span>
      </button>
    );
  });
}


function CavingRows({ rows, matchFor, selected, onSelect, kbdId, kbdLens, lensKey = "caving" }) {
  return rows.map((row) => {
    const active = selected?.type === "caving" && selected.id === row.id;
    return (
      <button
        key={row.id}
        type="button"
        className="desk-queue-row"
        data-active={active}
        data-urgent={row.statusLabel === "Needs attention" || undefined}
        data-kbd={kbdLens === lensKey && kbdId === row.id ? "" : undefined}
        data-row-key={row.id}
        onClick={() => onSelect({ type: "caving", id: row.id })}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar characterId={row.characterId} name={row.characterName} version={row.avatarVersion} catatonic={row.catatonic} />
            <span className="truncate">
              ⚀ {row.die} — {row.characterName}
            </span>
            <MatchHint match={matchFor(row)} />
          </span>
          <StatusPill tone={CAVING_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.zoneName} · {row.kindLabel}
        </span>
        {row.lootTagName && <span className="block truncate text-xs text-muted">{row.lootTier} → {row.lootTagName}</span>}
      </button>
    );
  });
}

// One held pair. It opens the INSPECTOR on the person being held rather than a
// desk, because there is no desk for a fight — what a GM wants next is that
// person's sheet, their band, and what they filed.
// A picture waiting on a GM (docs/systemdocs/PORTRAITS.md §1a). The odd row in
// this lens: every other one is a thing that happened and is read, and this one
// is a thing to DO, so it is the only row carrying its own buttons.
//
// WHY IT IS NOT ONE BUTTON. .desk-queue-row IS a <button> — the whole row opens
// the inspector. Keep and Reject cannot nest inside that, so the row and its
// actions are siblings inside .desk-queue-rowset, which takes over the border
// and the layout. Scoped to this row: five other surfaces draw .desk-queue-row.
function AvatarReviewRow({ row, matchFor, onInspect, active, kbd }) {
  const [refresh] = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const answer = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = noteActionVersion(await fn({ characterId: row.characterId }));
      // A second GM answering the same row first is the ordinary case here,
      // not an exception: both of them are looking at the same queue. Refresh
      // either way, so the row that is already dealt with leaves the screen.
      if (result?.error) setError(result.error);
    } catch (err) {
      // guarded() turns a UserError into a result; anything else REJECTS, and
      // an uncaught rejection here reaches (desk)/error.js and replaces the
      // whole desk with an error page over one avatar row.
      setError(mutationErrorMessage(err));
    }
    setBusy(false);
    // STILL A REFRESH, and the only three left on this desk that are. The
    // Other lens's rows are not desk-store rows: an avatar awaiting review is
    // a Character, and a hold is an Attack or an Intercept hit, so none of the
    // four types web/lib/deskRows.js#deskPatchFor can re-read covers them and
    // there is nothing to hand back a patch of. Giving them one would mean a
    // fifth row type through the store, the stream and the trigger set for
    // three buttons nobody presses twice a turn. They keep the refresh — now
    // the GUARDED one (DeskStaleRefreshGate), with noteActionVersion above
    // latching the chip on the first press after a deploy rather than leaving
    // it to the 120s poll.
    refresh();
  };

  return (
    <div className="desk-queue-rowset" data-active={active} data-kbd={kbd ? "" : undefined}>
      <button
        type="button"
        className="desk-queue-row"
        data-row-key={row.id}
        onClick={() => onInspect?.(row.characterId, row.characterName, row.id)}
      >
        <span className="flex items-center gap-2">
          <CharacterAvatar
            characterId={row.characterId}
            name={row.characterName}
            version={row.avatarVersion}
            catatonic={row.catatonic}
            size={40}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 truncate font-medium">
              <span className="truncate">{row.characterName}</span>
              <MatchHint match={matchFor(row)} />
            </span>
            <span className="block truncate text-xs text-muted">
              {error ?? "Uploaded a portrait"}
            </span>
          </span>
        </span>
      </button>
      <span className="desk-queue-actions">
        <IconButton
          icon={CheckIcon}
          label="Keep"
          disabled={busy}
          onClick={() => answer(keepAvatar)}
        />
        <IconButton
          icon={CloseIcon}
          label="Reject"
          disabled={busy}
          onClick={() => answer(rejectAvatar)}
        />
      </span>
    </div>
  );
}

// A fulfilled Desire claim waiting on a GM (docs/systemdocs/DESIRES.md §6).
// The row's own lens now, not folded into Other — a claim holds nobody in
// place and carries no fight to read at a glance, so it earns its own list
// rather than a second shape crammed into that one.
//
// Same reasoning as AvatarReviewRow, verbatim: .desk-queue-row IS a button,
// so Keep and Reject are siblings in .desk-queue-rowset rather than nested
// inside it, and this uses the same guarded refresh() rather than a
// desk-store patch — a Desire is a Character row, not one of the four types
// web/lib/deskRows.js#deskPatchFor knows how to re-read.
//
// An already-reviewed row keeps its place in the rail (desireReviewWhere()
// deliberately doesn't filter reviewedAt out) but loses its buttons and
// dims via [data-auto] — the same "already dealt with, no GM attention
// needed" affordance a Travel Move's row already wears.
function DesireClaimRow({ row, matchFor, onInspect, onSelect, active, kbd }) {
  const confirm = useConfirm();
  const [refresh] = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reviewed = Boolean(row.reviewedAt);

  const open = () => {
    onSelect?.({ type: "desire", id: row.id });
    onInspect?.(row.characterId, row.characterName);
  };

  const answer = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = noteActionVersion(await fn({ desireId: row.id }));
      // A second GM answering the same claim first is the ordinary case, not
      // an exception — see AvatarReviewRow's identical comment.
      if (result?.error) setError(result.error);
    } catch (err) {
      setError(mutationErrorMessage(err));
    }
    setBusy(false);
    refresh();
  };

  const reject = async () => {
    if (busy) return;
    const ok = await confirm({
      title: "Reject this claim?",
      message: `Takes ${row.points} tag point${row.points === 1 ? "" : "s"} back off ${row.characterName} and tells them so.`,
      confirmLabel: "Reject",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    answer(rejectDesireClaim);
  };

  return (
    <div className="desk-queue-rowset" data-active={active} data-kbd={kbd ? "" : undefined}>
      <button
        type="button"
        className="desk-queue-row"
        data-auto={reviewed || undefined}
        data-row-key={row.id}
        onClick={open}
      >
        <span className="flex items-center gap-2">
          <CharacterAvatar
            characterId={row.characterId}
            name={row.characterName}
            version={row.avatarVersion}
            catatonic={row.catatonic}
            size={40}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 truncate font-medium">
              <span className="truncate">{row.characterName}</span>
              <MatchHint match={matchFor(row)} />
            </span>
            <span className="block truncate text-xs text-muted">
              {row.desireName} · {row.points} pt{row.points === 1 ? "" : "s"}
            </span>
            <span className="block truncate text-xs text-muted">{error ?? (row.reason ? `» ${row.reason}` : "No reason given")}</span>
          </span>
        </span>
      </button>
      {!reviewed && (
        <span className="desk-queue-actions">
          <IconButton icon={CheckIcon} label="Keep" disabled={busy} onClick={() => answer(keepDesireClaim)} />
          <IconButton icon={CloseIcon} label="Reject" disabled={busy} onClick={reject} />
        </span>
      )}
    </div>
  );
}

// What each person is in this row FOR, in the fewest words that stay true.
const HOLD_ROLE_LABELS = {
  attacking: "attacking",
  held: "held",
  stopping: "stopping",
  stopped: "stopped",
};

// One fight, drawn as a row plus a strip of the people in it
// (docs/systemdocs/ATTACK.md §7).
//
// The strip is INLINE and always open rather than a desk or a disclosure: the
// whole point of this lens is seeing at a glance whether anything is
// happening, and a fight you have to click twice to read is one a GM scrolls
// past. There is still no desk — clicking a name opens the inspector, which is
// what a GM wants next.
//
// WHY IT IS NOT ONE BUTTON, the AvatarReviewRow reasoning verbatim:
// .desk-queue-row IS a <button>, so the names, the Move chips and the ✕ cannot
// nest inside it. The row and its strip are siblings inside
// .desk-queue-rowset, which takes over the border and the layout.
function HoldRow({ row, matchFor, onInspect, onOpenMove, active, kbd }) {
  const [refresh] = useRefresh();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const cancel = async (hold) => {
    if (busy) return;
    setBusy(hold.attackId);
    setError(null);
    try {
      const result = noteActionVersion(await cancelHoldAsGm({ attackId: hold.attackId }));
      if (result?.error) setError(result.error);
    } catch (err) {
      setError(mutationErrorMessage(err));
    }
    setBusy(null);
    // A refresh rather than a patch, for the reason AvatarReviewRow gives.
    refresh();
  };

  const live = row.holds.filter((h) => !h.cancelled);

  return (
    <div className="desk-queue-rowset" data-stacked="" data-active={active} data-kbd={kbd ? "" : undefined}>
      <button
        type="button"
        className="desk-queue-row"
        data-urgent={row.statusLabel === "Holding" || undefined}
        data-row-key={row.id}
        onClick={() => onInspect?.(row.targetCharacterId, row.targetName, row.id)}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <CharacterAvatar
              characterId={row.characterId}
              name={row.characterName}
              version={row.avatarVersion}
              catatonic={row.catatonic}
            />
            <span className="truncate">
              {row.characterName} → {row.targetName}
              {row.extraCount > 0 ? ` +${row.extraCount}` : ""}
            </span>
            <MatchHint match={matchFor(row)} />
          </span>
          <StatusPill tone={OTHER_TONES[row.statusLabel] ?? "neutral"}>{row.statusLabel}</StatusPill>
        </span>
        <span className="block truncate text-xs text-muted">
          {row.kindLabel}
          {row.locationName ? ` · ${row.locationName}` : row.zoneName ? ` · ${row.zoneName}` : ""}
        </span>
      </button>
      <div className="desk-queue-web">
        {row.people.map((p) => (
          <div key={p.characterId} className="desk-queue-web-line">
            <button
              type="button"
              className="desk-queue-web-name"
              onClick={() => onInspect?.(p.characterId, p.name, row.id)}
            >
              {p.name}
            </button>
            <span className="text-xs text-muted">{HOLD_ROLE_LABELS[p.role] ?? p.role}</span>
            {p.moves.length > 0 ? (
              p.moves.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chip chip-quiet"
                  onClick={() => onOpenMove?.(m.id)}
                >
                  {m.kindLabel}
                </button>
              ))
            ) : (
              <span className="text-xs text-muted">no Move</span>
            )}
          </div>
        ))}
        {live.length > 0 && (
          <div className="desk-queue-web-cancels">
            {live.map((h) => (
              <span key={h.attackId} className="desk-queue-web-cancel">
                <span className="truncate text-xs text-muted">
                  {h.attackerName} → {h.targetName}
                </span>
                <IconButton
                  icon={CloseIcon}
                  label={`Call off ${h.attackerName} → ${h.targetName}`}
                  disabled={busy != null}
                  onClick={() => cancel(h)}
                />
              </span>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-accent">{error}</p>}
      </div>
    </div>
  );
}

// One out-of-character line (db/lib/ooc.js). The row opens a DESK now — the
// surrounding transcript with this line marked (OocDesk.js) — because a line
// on its own tells a GM nothing about what prompted it, which is the question
// they are reading the lens to answer.
//
// A plain .desk-queue-row rather than a .desk-queue-rowset: the rowset exists
// to hang sibling action buttons off, and the verbs live on the desk.
function OocRow({ row, matchFor, onSelect, active, kbd }) {
  return (
    <button
      type="button"
      className="desk-queue-row"
      data-row-key={row.id}
      data-active={active || undefined}
      data-kbd={kbd ? "" : undefined}
      onClick={() => onSelect?.({ type: "ooc", id: row.id })}
    >
      <span className="flex items-center gap-2">
        <CharacterAvatar
          characterId={row.characterId}
          name={row.characterName}
          version={row.avatarVersion}
          catatonic={row.catatonic}
          size={40}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate font-medium">
            <span className="truncate">{row.characterName}</span>
            <MatchHint match={matchFor(row)} />
          </span>
          {/* The words, then where. Two lines rather than one: the sentence is
              what the lens is for, and sharing a line with a place name would
              truncate it first. */}
          <span className="block truncate text-xs">{row.text}</span>
          {row.placeName && (
            <span className="block truncate text-xs text-muted">{row.placeName}</span>
          )}
        </span>
      </span>
    </button>
  );
}

function OtherRows({ rows, matchFor, onInspect, onOpenMove, kbdId, kbdLens, openRowId }) {
  return rows.map((row) => {
    const active = openRowId === row.id;
    const kbd = kbdLens === "other" && kbdId === row.id;
    if (row.kind === "AVATAR") {
      return (
        <AvatarReviewRow
          key={row.id}
          row={row}
          matchFor={matchFor}
          onInspect={onInspect}
          active={active}
          kbd={kbd}
        />
      );
    }
    // Keyed to the ROW, not to the person being held: one person can be in
    // two of these at once, and every row naming them lighting up reads as
    // two selections.
    return (
      <HoldRow
        key={row.id}
        row={row}
        matchFor={matchFor}
        onInspect={onInspect}
        onOpenMove={onOpenMove}
        active={active}
        kbd={kbd}
      />
    );
  });
}

export default function QueueRail({
  moves,
  cavingRolls,
  otherRows,
  desireRows,
  oocRows,
  onInspect,
  onOpenMove,
  visibleZoneNames,
  stagedByMove,
  selected,
  onSelect,
  lens,
  onLens,
  gmProfiles,
  tagsById,
  historyTurnOptions,
  historyIsOpenTurn,
  historyTurnId,
  onHistoryTurn,
  historyMoves,
  historyStagedByMove,
  historyKind,
  onHistoryKind,
  historyCavingRolls,
  historyLoading,
  historyError,
}) {
  const moveFilterDefs = useMemo(() => MOVE_FILTER_DEFS, []);
  const cavingFilterDefs = useMemo(() => CAVING_FILTER_DEFS, []);
  const otherFilterDefs = useMemo(() => OTHER_FILTER_DEFS, []);
  const desireFilterDefs = useMemo(() => DESIRE_FILTER_DEFS, []);
  const oocFilterDefs = useMemo(() => OOC_FILTER_DEFS, []);
  const moveSearchMap = useMemo(() => makeMoveSearchMap(tagsById), [tagsById]);

  // The rail's persisted view state. Each table's filters live under their
  // own sub-key via useTableState's controlled mode (DataTable.js).
  const [rail, setRail] = useSessionState(RAIL_STORAGE_KEY, RAIL_STORAGE_DEFAULT);
  const makeFiltersProps = useCallback(
    (key) => ({
      filters: rail.filters[key] ?? {},
      onFiltersChange: (next) => setRail((r) => ({ ...r, filters: { ...r.filters, [key]: next } })),
    }),
    [rail.filters, setRail],
  );

  // The zones this GM chose to see (null = all), over every lens, applied
  // before ranking so the counts on the lens tabs match what is in them. Not
  // the same thing as the Zone dropdown below, which narrows WITHIN this.
  //
  // A view rather than enforcement — the server ships every row and a direct
  // link still opens a hidden Move. The boundary that bites is the Discord
  // half (GAMEMASTERS.md §6).
  // The prop is only the seed: once the picker in the inspector has moved,
  // the live answer is in the client (GmZoneViewProvider).
  const zonesInView = useVisibleZoneNames(visibleZoneNames);
  const inView = useCallback((rows) => inVisibleZones(rows, zonesInView), [zonesInView]);

  // One numeric key so the generic engine's one-field sort ranks by status
  // first, recency second (status multiplied out of recency's range).
  const rankedMoves = useMemo(
    () =>
      inView(moves).map((r) => ({
        ...r,
        queueOrder: (MOVE_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [moves, inView],
  );

  const rankedHistoryMoves = useMemo(
    () =>
      inView(historyMoves).map((r) => ({
        ...r,
        queueOrder: (MOVE_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [historyMoves, inView],
  );

  const rankedCavingRolls = useMemo(
    () =>
      inView(cavingRolls).map((r) => ({
        ...r,
        queueOrder: (CAVING_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [cavingRolls, inView],
  );

  const rankedOtherRows = useMemo(
    () =>
      inView(otherRows).map((r) => ({
        ...r,
        queueOrder: (OTHER_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [otherRows, inView],
  );

  const rankedDesireRows = useMemo(
    () =>
      inView(desireRows).map((r) => ({
        ...r,
        queueOrder: (DESIRE_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [desireRows, inView],
  );

  // All five tables mount permanently so lens flips keep each one's filters.
  // rankBySearch: true — no sortable headers to preserve, a query reorders.
  const moveTable = useTableState({
    rows: rankedMoves,
    filterDefs: moveFilterDefs,
    searchMap: moveSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("moves"),
  });
  const cavingTable = useTableState({
    rows: rankedCavingRolls,
    filterDefs: cavingFilterDefs,
    searchMap: cavingSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("caving"),
  });
  const otherTable = useTableState({
    rows: rankedOtherRows,
    filterDefs: otherFilterDefs,
    searchMap: otherSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("other"),
  });
  const desireTable = useTableState({
    rows: rankedDesireRows,
    filterDefs: desireFilterDefs,
    searchMap: desireSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("desires"),
  });
  // The OOC lens. Newest first and nothing else — there is no status to sort
  // ahead of recency the way every other lens has, because none of these rows
  // is waiting on anybody.
  const rankedOocRows = useMemo(
    () => inView(oocRows ?? []).map((r) => ({ ...r, queueOrder: -r.createdAtMs })),
    [oocRows, inView],
  );
  const oocTable = useTableState({
    rows: rankedOocRows,
    filterDefs: oocFilterDefs,
    searchMap: oocSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("ooc"),
  });

  // The History lens is the Moves lens over a past turn.
  const historyTable = useTableState({
    rows: rankedHistoryMoves,
    filterDefs: moveFilterDefs,
    searchMap: moveSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("history"),
  });
  // The History lens's Caving twin, with its own filter/search/scroll state.
  const rankedHistoryCavingRolls = useMemo(
    () =>
      (historyCavingRolls ?? []).map((r) => ({
        ...r,
        queueOrder: (CAVING_STATUS_RANK[r.statusLabel] ?? 0) * 1e15 - r.createdAtMs,
      })),
    [historyCavingRolls],
  );
  const historyCavingTable = useTableState({
    rows: rankedHistoryCavingRolls,
    filterDefs: cavingFilterDefs,
    searchMap: cavingSearchMap,
    rankBySearch: true,
    initialSort: { key: "queueOrder", dir: "asc" },
    pageSize: 1000,
    ...makeFiltersProps("history-caving"),
  });

  // Restores persisted search text once, on the first post-hydration render
  // — a render-time one-shot (react-hooks/set-state-in-effect is an error
  // here), never during hydration itself.
  const hydrated = useSyncExternalStore(subscribeNever, getTrue, getFalse);
  const [viewRestored, setViewRestored] = useState(false);
  if (hydrated && !viewRestored) {
    setViewRestored(true);
    const storedQuery = readSession(VIEW_STORAGE_KEY, VIEW_STORAGE_DEFAULT).query ?? {};
    if (storedQuery.moves) moveTable.setQuery(storedQuery.moves);
    if (storedQuery.caving) cavingTable.setQuery(storedQuery.caving);
    if (storedQuery.other) otherTable.setQuery(storedQuery.other);
    if (storedQuery.desires) desireTable.setQuery(storedQuery.desires);
    if (storedQuery.history) historyTable.setQuery(storedQuery.history);
    if (storedQuery["history-caving"]) historyCavingTable.setQuery(storedQuery["history-caving"]);
  }

  // Mirror search text back out, debounced with a pagehide flush. Gated on
  // viewRestored so the first render can't overwrite stored queries.
  useEffect(() => {
    if (!viewRestored) return undefined;
    const write = () =>
      mergeView({
        query: {
          moves: moveTable.query,
          caving: cavingTable.query,
          other: otherTable.query,
          desires: desireTable.query,
          history: historyTable.query,
          "history-caving": historyCavingTable.query,
        },
      });
    const id = setTimeout(write, 400);
    window.addEventListener("pagehide", write);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pagehide", write);
    };
  }, [
    viewRestored,
    moveTable.query,
    cavingTable.query,
    otherTable.query,
    desireTable.query,
    historyTable.query,
    historyCavingTable.query,
  ]);

  // Auto-filed travel Moves are already solved and hidden by default;
  // picking "Travel" in the Kind dropdown overrides the hide.
  const hideTravel = rail.hideTravel ?? true;
  const setHideTravel = useCallback((v) => setRail((r) => ({ ...r, hideTravel: v })), [setRail]);
  const movesShown = useMemo(() => {
    if (!hideTravel || moveTable.filters.kind === "Travel") return moveTable.visible;
    return moveTable.visible.filter((r) => !r.isTravel);
  }, [moveTable.visible, moveTable.filters.kind, hideTravel]);
  const hiddenTravelCount = moveTable.visible.length - movesShown.length;

  const hideHistoryTravel = rail.hideHistoryTravel ?? true;
  const setHideHistoryTravel = useCallback((v) => setRail((r) => ({ ...r, hideHistoryTravel: v })), [setRail]);
  const historyShown = useMemo(() => {
    if (!hideHistoryTravel || historyTable.filters.kind === "Travel") return historyTable.visible;
    return historyTable.visible.filter((r) => !r.isTravel);
  }, [historyTable.visible, historyTable.filters.kind, hideHistoryTravel]);
  const hiddenHistoryTravelCount = historyTable.visible.length - historyShown.length;

  // The History lens reads either past Moves or past Caving rolls, chosen
  // by its header switch (historyKind). Everything below branches on it.
  const historyIsCaving = lens === "history" && historyKind === "caving";
  const rowsForLens = useMemo(
    () => ({
      moves: movesShown,
      caving: cavingTable.visible,
      other: otherTable.visible,
      desires: desireTable.visible,
      ooc: oocTable.visible,
      history: historyIsCaving ? historyCavingTable.visible : historyShown,
    }),
    [
      movesShown,
      cavingTable.visible,
      otherTable.visible,
      desireTable.visible,
      oocTable.visible,
      historyIsCaving,
      historyCavingTable.visible,
      historyShown,
    ],
  );
  const visibleRows = rowsForLens[lens] ?? movesShown;
  const historySelectionType = historyIsCaving ? "caving" : historyIsOpenTurn ? "move" : "history";
  // Which Other row was last opened. Local rather than lifted into `selected`:
  // an Other row opens the INSPECTOR, not a desk, so it is not a selection the
  // workspace or the URL has any opinion about — it is just the row you last
  // pressed, so the rail can show you where you are in a long list.
  const [openRowId, setOpenRowId] = useState(null);
  // Tracked by ROW ID, not position — a status change re-sorts the rail, and
  // an index-based cursor would follow the slot instead of the row.
  const [kbdCursorId, setKbdCursorId] = useState(null);
  const railRef = useRef(null);
  const coarse = useIsCoarsePointer();

  // Scroll position per lens, saved (debounced) into the view key, restored
  // once per lens activation. Restoring assigns scrollTop directly.
  const queueRef = useRef(null);
  const scrollWriteTimer = useRef(0);
  const pendingScroll = useRef(null); // { lens, top }
  // Flush-not-discard: a pending write for a DIFFERENT lens flushes instead
  // of being silently overwritten by a lens flip's scrollTop=0.
  const flushScroll = useCallback(() => {
    clearTimeout(scrollWriteTimer.current);
    const pending = pendingScroll.current;
    if (!pending) return;
    pendingScroll.current = null;
    mergeView({ scroll: { [pending.lens]: pending.top } });
  }, []);
  const onQueueScroll = useCallback(
    (e) => {
      const top = e.currentTarget.scrollTop;
      const key = lens ?? "moves";
      if (pendingScroll.current && pendingScroll.current.lens !== key) flushScroll();
      pendingScroll.current = { lens: key, top };
      clearTimeout(scrollWriteTimer.current);
      scrollWriteTimer.current = setTimeout(flushScroll, 200);
    },
    [lens, flushScroll],
  );
  // Same pagehide flush as the query mirror; unmount flushes too.
  useEffect(() => {
    window.addEventListener("pagehide", flushScroll);
    return () => {
      window.removeEventListener("pagehide", flushScroll);
      flushScroll();
    };
  }, [flushScroll]);

  const restoredScrollLens = useRef(null);
  useEffect(() => {
    if (!viewRestored) return;
    if (restoredScrollLens.current === lens) return;
    const el = queueRef.current;
    if (!el) return;
    const top = readSession(VIEW_STORAGE_KEY, VIEW_STORAGE_DEFAULT).scroll?.[lens ?? "moves"];
    if (typeof top === "number" && top > 0) {
      // History rows arrive async — hold off restoring against an empty list.
      if (visibleRows.length === 0) return;
      el.scrollTop = top;
    } else {
      // The scroller div is reused across lens flips, so a fresh lens must
      // be reset explicitly or it inherits the previous scroll offset.
      el.scrollTop = 0;
    }
    restoredScrollLens.current = lens;
  }, [viewRestored, lens, visibleRows.length]);

  // The Desires tab count — UNREVIEWED rows in view, not the total, so the
  // number on the tab is the one that tells a GM whether opening it is worth
  // it (the Moves tab counts everything shown, but every Move shown is
  // something to look at; a reviewed Desire row is not).
  const desireUnreviewedCount = useMemo(
    () => desireTable.visible.filter((r) => !r.reviewedAt).length,
    [desireTable.visible],
  );

  const clampedKbdIndex = kbdCursorId ? visibleRows.findIndex((r) => r.id === kbdCursorId) : -1;
  const kbdId = clampedKbdIndex >= 0 ? visibleRows[clampedKbdIndex]?.id : null;

  useEffect(() => {
    if (coarse) return undefined;
    function onKey(e) {
      const key = e.key;
      const isNav = key === "ArrowDown" || key === "ArrowUp" || key === "j" || key === "k" || key === "Enter";
      const isLensKey = key === "m" || key === "r" || key === "c" || key === "o" || key === "h" || key === "d";
      if (!isNav && !isLensKey) return;
      if (hasModifier(e)) return;
      if (dialogHoldsKeyboard()) return;
      if (isFieldFocused(document.activeElement)) return;

      if (isLensKey) {
        onLens?.(LENS_FOR_KEY[key]);
        setKbdCursorId(null);
        return;
      }

      const rows = rowsForLens[lens] ?? [];
      if (!rows.length) return;

      if (key === "Enter") {
        const row = clampedKbdIndex >= 0 ? rows[clampedKbdIndex] : null;
        if (!row) return;
        // The Other lens has no desk — ⏎ opens the inspector on the person
        // being held, the same thing clicking the row does.
        if (lens === "other") {
          setOpenRowId(row.id);
          onInspect?.(row.targetCharacterId, row.targetName);
          return;
        }
        const type = lens === "history" ? historySelectionType : (SELECTION_TYPE_FOR_LENS[lens] ?? "move");
        onSelect({ type, id: row.id });
        return;
      }

      e.preventDefault();
      const delta = key === "ArrowDown" || key === "j" ? 1 : -1;
      const next = Math.max(0, Math.min(rows.length - 1, clampedKbdIndex + delta));
      setKbdCursorId(rows[next].id);
      railRef.current?.querySelector(`[data-row-key="${rows[next].id}"]`)?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    lens,
    onLens,
    onSelect,
    rowsForLens,
    clampedKbdIndex,
    coarse,
    historySelectionType,
    onInspect,
  ]);

  return (
    <aside className="desk-rail" ref={railRef}>
      <div className="segmented desk-rail-lens" role="group" aria-label="Queue lens">
        <button type="button" aria-pressed={lens === "moves" || !lens} onClick={() => onLens?.("moves")}>
          Moves ({movesShown.length})
        </button>
        <button type="button" aria-pressed={lens === "caving"} onClick={() => onLens?.("caving")}>
          Caving
        </button>
        <button type="button" aria-pressed={lens === "other"} onClick={() => onLens?.("other")}>
          Other
        </button>
        <button type="button" aria-pressed={lens === "desires"} onClick={() => onLens?.("desires")}>
          Desires{desireUnreviewedCount > 0 ? ` (${desireUnreviewedCount})` : ""}
        </button>
        <button type="button" aria-pressed={lens === "ooc"} onClick={() => onLens?.("ooc")}>
          OOC{oocTable.total > 0 ? ` (${oocTable.total})` : ""}
        </button>
        <button type="button" aria-pressed={lens === "history"} onClick={() => onLens?.("history")}>
          History
        </button>
      </div>

      {lens === "history" ? (
        <>
          <RailFilters
            table={historyIsCaving ? historyCavingTable : historyTable}
            filterDefs={historyIsCaving ? cavingFilterDefs : moveFilterDefs}
            searchPlaceholder={
              historyIsCaving ? "name, @handle, tag:…" : "name, role, @handle, zone:…"
            }
            header={
              /* Two selects on one line: WHAT of WHICH turn. The kind used to
                 be a second .segmented stacked directly under the lens
                 segmented above — the same control, the same width, the same
                 two of its four words ("Moves", "Caving"), eight pixels apart,
                 and a GM reading down the rail hit the pair as one eight-button
                 control with no way to tell which row meant what. The lens
                 chooses the lens; inside History, kind is a parameter of the
                 view like the turn is, so it is drawn like the turn is. */
              <div className="desk-rail-filter-line">
                <label className="field min-w-0" style={{ flex: "1 1 7rem" }}>
                  <span className="field-label">Showing</span>
                  <Select
                    value={historyKind === "caving" ? "caving" : "moves"}
                    onChange={(e) => onHistoryKind?.(e.target.value)}
                  >
                    <option value="moves">Moves</option>
                    <option value="caving">Caving</option>
                  </Select>
                </label>
                <label className="field min-w-0" style={{ flex: "1 1 7rem" }}>
                  <span className="field-label">Turn</span>
                  <Select
                    value={historyTurnId ?? ""}
                    disabled={!historyTurnOptions?.length}
                    onChange={(e) => onHistoryTurn?.(e.target.value)}
                  >
                    {historyTurnOptions?.length ? (
                      historyTurnOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))
                    ) : (
                      <option value="">No turns yet</option>
                    )}
                  </Select>
                </label>
              </div>
            }
          >
            {!historyIsCaving && hiddenHistoryTravelCount > 0 && (
              <label className="field-label flex items-center gap-1.5" style={{ fontWeight: "normal" }}>
                <input
                  type="checkbox"
                  checked={!hideHistoryTravel}
                  onChange={(e) => setHideHistoryTravel(!e.target.checked)}
                />
                Show {hiddenHistoryTravelCount} travel
              </label>
            )}
          </RailFilters>
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
            {historyIsCaving ? (
              <>
                <CavingRows
                  rows={historyCavingTable.visible}
                  matchFor={historyCavingTable.matchFor}
                  selected={selected}
                  onSelect={onSelect}
                  kbdId={kbdId}
                  kbdLens={lens}
                  lensKey="history"
                />
                {historyError && <p className="p-3 text-sm form-error">{historyError}</p>}
                {!historyError && historyLoading && (
                  <p className="p-3 text-sm text-muted">Loading that turn…</p>
                )}
                {!historyError && !historyLoading && historyCavingTable.visible.length === 0 && (
                  <p className="p-3 text-sm text-muted">
                    {historyTurnOptions?.length
                      ? "No Caving rolls on that turn match."
                      : "No turn to read back yet."}
                  </p>
                )}
              </>
            ) : (
              <>
                <MoveRows
                  rows={historyShown}
                  matchFor={historyTable.matchFor}
                  stagedByMove={historyStagedByMove ?? new Map()}
                  selected={selected}
                  onSelect={onSelect}
                  gmProfiles={gmProfiles}
                  kbdId={kbdId}
                  kbdLens={lens}
                  // On the open turn a History row is still LIVE, so it opens
                  // the ordinary MoveDesk; MoveHistoryDesk never renders for
                  // an unpushed turn.
                  type={historyIsOpenTurn ? "move" : "history"}
                  lensKey="history"
                />
                {historyError && <p className="p-3 text-sm form-error">{historyError}</p>}
                {!historyError && historyLoading && (
                  <p className="p-3 text-sm text-muted">Loading that turn…</p>
                )}
                {!historyError && !historyLoading && historyShown.length === 0 && (
                  <p className="p-3 text-sm text-muted">
                    {historyTurnOptions?.length
                      ? hiddenHistoryTravelCount > 0
                        ? `No Moves match — ${hiddenHistoryTravelCount} travel Move${hiddenHistoryTravelCount === 1 ? "" : "s"} hidden.`
                        : "No Moves on that turn match."
                      : "No turn to read back yet."}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      ) : lens === "desires" ? (
        <>
          <RailFilters
            table={desireTable}
            filterDefs={desireFilterDefs}
            searchPlaceholder="name, desire, reason…"
          />
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
            {desireTable.visible.map((row) => (
              <DesireClaimRow
                key={row.id}
                row={row}
                matchFor={desireTable.matchFor}
                onInspect={onInspect}
                onSelect={onSelect}
                active={selected?.type === "desire" && selected.id === row.id}
                kbd={lens === "desires" && kbdId === row.id}
              />
            ))}
            {desireTable.total === 0 && (
              <p className="p-3 text-sm text-muted">No desire claims to review.</p>
            )}
          </div>
        </>
      ) : lens === "other" ? (
        <>
          <RailFilters
            table={otherTable}
            filterDefs={otherFilterDefs}
            searchPlaceholder="name, target, @handle, zone:…"
          />
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
            <OtherRows
              rows={otherTable.visible}
              matchFor={otherTable.matchFor}
              onInspect={(id, name, rowId) => {
                setOpenRowId(rowId);
                onInspect?.(id, name);
              }}
              onOpenMove={onOpenMove}
              openRowId={openRowId}
              kbdId={kbdId}
              kbdLens={lens}
            />
            {otherTable.total === 0 && (
              <p className="p-3 text-sm text-muted">No miscellaneous requests.</p>
            )}
          </div>
        </>
      ) : lens === "ooc" ? (
        <>
          <RailFilters
            table={oocTable}
            filterDefs={oocFilterDefs}
            searchPlaceholder="name, @handle, what was said…"
          />
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
            {oocTable.visible.map((row) => (
              <OocRow
                key={row.id}
                row={row}
                matchFor={oocTable.matchFor}
                onSelect={onSelect}
                active={selected?.type === "ooc" && selected.id === row.id}
                kbd={lens === "ooc" && kbdId === row.id}
              />
            ))}
            {oocTable.total === 0 && (
              <p className="p-3 text-sm text-muted">Nothing said out of character this turn.</p>
            )}
          </div>
        </>
      ) : lens === "caving" ? (
        <>
          <RailFilters
            table={cavingTable}
            filterDefs={cavingFilterDefs}
            searchPlaceholder="name, @handle, tag:…"
          />
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
            <CavingRows
              rows={cavingTable.visible}
              matchFor={cavingTable.matchFor}
              selected={selected}
              onSelect={onSelect}
              kbdId={kbdId}
              kbdLens={lens}
            />
            {cavingTable.total === 0 && <p className="p-3 text-sm text-muted">No Caving rolls match.</p>}
          </div>
        </>
      ) : (
        <>
          <RailFilters
            table={moveTable}
            filterDefs={moveFilterDefs}
            searchPlaceholder="name, role, @handle, zone:…"
          >
            {/* CheckField, not a bare <input type="checkbox"> in a
                hand-rolled <label> — the exact shape DESIGN-SYSTEM §5a names.
                Outside .field it fell back to unstyled browser chrome and was
                the one white box on the desk. */}
            {hiddenTravelCount > 0 && (
              <CheckField checked={!hideTravel} onChange={(e) => setHideTravel(!e.target.checked)}>
                Show {hiddenTravelCount} travel
              </CheckField>
            )}
          </RailFilters>
          <div className="desk-queue" ref={queueRef} onScroll={onQueueScroll}>
            <MoveRows
              rows={movesShown}
              matchFor={moveTable.matchFor}
              stagedByMove={stagedByMove}
              selected={selected}
              onSelect={onSelect}
              gmProfiles={gmProfiles}
              kbdId={kbdId}
              kbdLens={lens}
            />
            {movesShown.length === 0 &&
              (hiddenTravelCount > 0 ? (
                <p className="p-3 text-sm text-muted">
                  No Moves match — {hiddenTravelCount} travel Move{hiddenTravelCount === 1 ? "" : "s"} hidden.
                </p>
              ) : (
                <p className="p-3 text-sm text-muted">No Moves match.</p>
              ))}
          </div>
        </>
      )}
      <p className="desk-rail-hint text-xs text-muted">↑↓ / j k navigate · ⏎ open · m/r/c/d/h lens · esc close</p>
    </aside>
  );
}
