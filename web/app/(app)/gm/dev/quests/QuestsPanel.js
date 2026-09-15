"use client";

// The Quests catalog: a rail of what is staged, and the one that is selected.
//
// Two jobs happen here and they want different shapes, which is why this is a
// split rather than a table. Scanning — what is live, where, how long has it
// got — is a glance down a list. Working on one is a form. A single wide table
// does the first job badly and the second not at all.
//
// Everything below is drawn in the desk vocabulary the rest of /gm/dev uses:
// .desk-card for a surface, .section-title for a heading that sits beside
// something, .ops-actions for a row of verbs, .select-card for a row you pick.
// It used to be bare .panel with no padding class, which is why it read as a
// stack of boxes with the text shoved against the border.
import { useId, useMemo, useState, useTransition } from "react";
import Link from "next/link";

import Modal from "@/app/components/Modal";
import Select from "@/app/components/Select";
import FormError from "@/app/components/FormError";
import EmptyState, { EmptyRow } from "@/app/components/EmptyState";
import StatusPill from "@/app/components/StatusPill";
import Pager from "@/app/components/Pager";
import { SortHeader, TableScroll, useTableState } from "@/app/components/DataTable";
import { useConfirm } from "@/app/components/ConfirmProvider";
import CheckPicker from "@/app/components/CheckPicker";
import {
  createQuestAction,
  updateQuestAction,
  closeQuestAction,
  deleteQuestAction,
} from "@/app/(app)/gm/dev/questActions";

const STATUS_TONE = { OPEN: "good", CLOSED: "neutral", EXPIRED: "warn" };

const RAIL_STATUS = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "CLOSED", label: "Closed" },
  { key: "EXPIRED", label: "Expired" },
];

// Module scope, not an inline literal: useTableState takes these as deps, and
// a fresh array every render re-runs the whole filter chain.
const INTERACTION_SEARCH = [(r) => r.characterName, (r) => r.intention];
const NO_FILTERS = [];

// What the rail shows instead of a date. A GM thinks in turns, and the number
// they actually scan for is how long they have got.
function clockLabel(quest) {
  if (quest.status !== "OPEN") return null;
  if (quest.turnsLeft == null) return "no expiry";
  if (quest.turnsLeft <= 0) return "due";
  return `${quest.turnsLeft} turn${quest.turnsLeft === 1 ? "" : "s"}`;
}

function QuestForm({ value, onChange, locations, tags, characters, pickerHeight = "18rem" }) {
  // The detail pane and the create modal can both hold a QuestForm at once, so
  // the ids have to be per-instance. Hardcoded, they collided and half the
  // labels pointed at the other form's control.
  const id = useId();
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="field">
        <label className="field-label" htmlFor={`${id}-title`}>
          Title
        </label>
        <input
          id={`${id}-title`}
          type="text"
          value={value.title}
          maxLength={90}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-description`}>
          What is here
        </label>
        <textarea
          id={`${id}-description`}
          rows={5}
          value={value.description}
          maxLength={1800}
          onChange={(e) => set({ description: e.target.value })}
        />
        <p className="text-sm text-muted">
          This is the room&apos;s starter post — the first thing anybody who walks in reads. Editing
          it rewrites that post in place, so nobody is pinged twice.
        </p>
      </div>

      <div className="ops-grid">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-location`}>
            Where
          </label>
          <Select
            id={`${id}-location`}
            value={value.locationId}
            onChange={(e) => set({ locationId: e.target.value })}
            disabled={value.locked}
          >
            <option value="">Pick a place…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
          {value.locked ? (
            <p className="text-sm text-muted">
              A thread cannot change channels, so a staged quest stays where it was staged. Close it
              and stage another to move it.
            </p>
          ) : null}
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-expiry`}>
            Lasts
          </label>
          <input
            id={`${id}-expiry`}
            type="number"
            min={0}
            value={value.expiresTurns}
            onChange={(e) => set({ expiresTurns: e.target.value })}
          />
          <p className="text-sm text-muted">
            In turns, counted from today. Zero or blank means it stands until somebody closes it.
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CheckPicker
          label="Needs one of these"
          items={tags}
          value={value.accessTagSlugs}
          onChange={(next) => set({ accessTagSlugs: next })}
          emptyLabel="No tag matches."
          filterPlaceholder="Tag name…"
          searchThreshold={0}
          maxHeight={pickerHeight}
          minHeight={pickerHeight}
        />
        <CheckPicker
          label="…or is one of these people"
          items={characters}
          value={value.allowedCharacterIds}
          onChange={(next) => set({ allowedCharacterIds: next })}
          emptyLabel="Nobody matches."
          filterPlaceholder="Name…"
          searchThreshold={0}
          maxHeight={pickerHeight}
          minHeight={pickerHeight}
        />
      </div>

      <p className="text-sm text-muted">
        Leave both empty and anybody standing there can see it. Set either one and the room becomes
        private.
      </p>
    </div>
  );
}

// Its own component, not inline JSX, because it holds a hook — inlining it
// behind `if (!selected)` would make that hook conditional.
function InteractionsTable({ rows }) {
  const table = useTableState({
    rows,
    searchFields: INTERACTION_SEARCH,
    filterDefs: NO_FILTERS,
    initialSort: { key: "turnNumber", dir: "desc" },
    pageSize: 25,
  });

  return (
    <div className="desk-card flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="section-title">Who has touched it</h4>
        {/* A count is neither a chip nor a pill — it is a muted line. */}
        <span className="mono text-sm text-muted">
          {rows.length} press{rows.length === 1 ? "" : "es"}
        </span>
      </div>

      {rows.length > 10 ? (
        <label className="field">
          <span className="field-label">Search</span>
          <input
            type="text"
            value={table.query}
            placeholder="Name, or what they said…"
            onChange={(e) => table.setQuery(e.target.value)}
          />
        </label>
      ) : null}

      {/* Three columns, so no minWidth — that is for the eight-column tables.
          TableScroll already draws its own .panel, so it is never wrapped. */}
      <TableScroll>
        <thead>
          <tr>
            <SortHeader label="Who" sortKey="characterName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Turn" sortKey="turnNumber" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col" className="col-prose">
              What they said they were doing
            </th>
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((i) => (
            <tr key={i.id}>
              <td>{i.characterName}</td>
              <td className="mono">{i.turnNumber ?? "—"}</td>
              <td>{i.intention}</td>
            </tr>
          ))}
          {table.pageRows.length === 0 ? (
            <EmptyRow cols={3}>{rows.length === 0 ? "Nobody yet." : "Nobody matches."}</EmptyRow>
          ) : null}
        </tbody>
      </TableScroll>

      {table.totalPages > 1 ? (
        <Pager
          page={table.page}
          totalPages={table.totalPages}
          total={table.total}
          unit="presses"
          onPage={table.setPage}
        />
      ) : null}
    </div>
  );
}

const BLANK = {
  title: "",
  description: "",
  locationId: "",
  expiresTurns: "",
  accessTagSlugs: [],
  allowedCharacterIds: [],
  locked: false,
};

export default function QuestsPanel({
  quests,
  locations,
  tags,
  characters,
  canDelete,
}) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const [selectedId, setSelectedId] = useState(quests[0]?.id ?? null);
  const [draft, setDraft] = useState(null);
  const [creating, setCreating] = useState(null);

  // The rail's own filters. Closed and expired quests never leave the list, so
  // without these a month-old game buries the three that are live.
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const selected = useMemo(() => quests.find((q) => q.id === selectedId) ?? null, [quests, selectedId]);

  // Mapped once here rather than inside QuestForm, so both the detail pane and
  // the create modal share one array apiece.
  const tagItems = useMemo(() => tags.map((t) => ({ id: t.slug, label: t.name })), [tags]);
  const characterItems = useMemo(() => characters.map((c) => ({ id: c.id, label: c.name })), [characters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return quests.filter((x) => {
      if (status && x.status !== status) return false;
      if (!q) return true;
      return `${x.title} ${x.locationName} ${x.zoneName}`.toLowerCase().includes(q);
    });
  }, [quests, query, status]);

  // The rail, grouped by zone with the caves first — that is where a quest
  // usually goes, so it should not be a scroll away. Grouped rather than run
  // through useTableState, whose pager would slice across a group boundary.
  const groups = useMemo(() => {
    const by = new Map();
    for (const q of visible) {
      if (!by.has(q.zoneName)) by.set(q.zoneName, { zoneName: q.zoneName, cave: q.cave, rows: [] });
      by.get(q.zoneName).rows.push(q);
    }
    return [...by.values()].sort((a, b) => {
      if (a.cave !== b.cave) return a.cave ? -1 : 1;
      return a.zoneName.localeCompare(b.zoneName);
    });
  }, [visible]);

  function pick(quest) {
    setSelectedId(quest.id);
    setError(null);
    setNote(null);
    setDraft(null);
  }

  const editing = draft ?? (selected
    ? {
        title: selected.title,
        description: selected.description,
        locationId: selected.locationId,
        expiresTurns: selected.turnsLeft == null ? "" : String(Math.max(selected.turnsLeft, 0)),
        accessTagSlugs: selected.accessTagSlugs,
        allowedCharacterIds: selected.allowedCharacterIds,
        locked: true,
      }
    : null);

  function run(fn, input, okNote) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await fn(input);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDraft(null);
      setNote(okNote);
      if (res?.questId) setSelectedId(res.questId);
    });
  }

  // Confirm first, transition second (DESIGN-SYSTEM.md §8) — awaiting the
  // dialog inside the transition deadlocks.
  async function close() {
    const ok = await confirm({
      title: `Close "${selected.title}"?`,
      message: "The room and its thread go. What people said they were doing there is kept.",
      confirmLabel: "Close it",
      cancelLabel: "Leave it open",
    });
    if (!ok) return;
    run(closeQuestAction, { questId: selected.id }, "Closed.");
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete "${selected.title}"?`,
      message:
        "This takes the record too — every Interact on it and what each person said they were trying to do. There is no undo.",
      confirmLabel: "Delete it",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    run(deleteQuestAction, { questId: selected.id }, "Deleted.");
    setSelectedId(null);
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="desk-card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="section-title">Staged</h4>
          <button type="button" className="btn-secondary" onClick={() => setCreating({ ...BLANK })}>
            New quest
          </button>
        </div>

        <label className="field">
          <span className="field-label">Search</span>
          <input
            type="text"
            value={query}
            placeholder="Title, place or zone…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {/* One value at a time, so aria-pressed rather than data-active:
            .segmented is a control with a value and a screen reader has to
            reach it. */}
        <div className="segmented">
          {RAIL_STATUS.map((s) => (
            <button
              key={s.key || "all"}
              type="button"
              aria-pressed={status === s.key}
              onClick={() => setStatus(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <span className="mono text-sm text-muted">
          {visible.length} of {quests.length} shown
        </span>

        <div className="list-scroll flex flex-col gap-3">
          {visible.length === 0 ? (
            <EmptyState>
              {quests.length === 0
                ? "Nothing is staged. A new quest appears as a room wherever you put it."
                : "Nothing matches."}
            </EmptyState>
          ) : (
            groups.map((group) => (
              <div key={group.zoneName} className="flex flex-col gap-1">
                <span className="quest-rail-zone">{group.zoneName}</span>
                {group.rows.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    aria-pressed={q.id === selectedId}
                    className="select-card panel flex min-h-11 w-full flex-col gap-1 p-3 text-left"
                    onClick={() => pick(q)}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{q.title}</span>
                      <StatusPill tone={STATUS_TONE[q.status] ?? "neutral"}>{q.status}</StatusPill>
                    </span>
                    {/* The stylesheet owns the separators, so a quest with no
                        clock leaves no dangling middot. */}
                    <span className="desk-staged-sub">
                      <span>{q.locationName}</span>
                      {clockLabel(q) ? <span className="mono">{clockLabel(q)}</span> : null}
                      {q.interactionCount > 0 ? (
                        <span className="mono">{q.interactionCount}&times;</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {!selected ? (
          <div className="desk-card">
            <EmptyState>Pick a quest, or stage a new one.</EmptyState>
          </div>
        ) : (
          <>
            <div className="desk-card flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="section-title">{selected.title}</h4>
                <StatusPill tone={STATUS_TONE[selected.status] ?? "neutral"}>{selected.status}</StatusPill>
              </div>

              {selected.status === "OPEN" ? (
                <QuestForm
                  value={editing}
                  onChange={setDraft}
                  locations={locations}
                  tags={tagItems}
                  characters={characterItems}
                />
              ) : (
                <p className="text-sm text-muted">
                  This one is over. Its room is gone; what is below is what happened while it stood.
                </p>
              )}

              <FormError>{error}</FormError>

              {/* .ops-actions, not .modal-actions — this is a form footer in a
                  card, not a modal's. Delete is pushed away from the safe
                  verbs rather than sitting flush against Close now. */}
              <div className="ops-actions">
                {selected.status === "OPEN" ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending || !draft}
                      onClick={() =>
                        run(updateQuestAction, { questId: selected.id, ...editing }, "Saved.")
                      }
                    >
                      {pending ? "Saving…" : "Save"}
                    </button>
                    {/* A plain Link, not a router.push: middle-click works,
                        and the prefill rides in the URL instead of in client
                        state a reload would drop. The panel it lands on
                        decides whether the zone is reachable — a cave has no
                        #summary, and it says so rather than ticking a lie. */}
                    <Link
                      className="btn-secondary"
                      href={`/gm/dev?s=bulk&verb=say&kind=zone&place=${encodeURIComponent(
                        selected.zoneId ?? "",
                      )}&text=${encodeURIComponent(
                        `Word is going round about something at the ${selected.locationName}.`,
                      )}`}
                    >
                      Advertise
                    </Link>
                    <button type="button" className="btn-secondary" disabled={pending} onClick={close}>
                      Close now
                    </button>
                  </>
                ) : null}
                {note ? <span className="self-center text-sm text-muted">{note}</span> : null}
                {/* ml-auto rides a wrapper, not the button: every .btn* here
                    is `all: unset`, which clears margin-left — and being
                    unlayered it beats Tailwind's utility rather than losing to
                    it, so the class on the button silently does nothing. */}
                {canDelete ? (
                  <span className="ml-auto">
                    <button type="button" className="btn-danger" disabled={pending} onClick={remove}>
                      Delete
                    </button>
                  </span>
                ) : null}
              </div>
            </div>

            <InteractionsTable rows={selected.interactions} />
          </>
        )}
      </div>

      {creating ? (
        <Modal open title="Stage a quest" onClose={() => setCreating(null)}>
          {/* A shorter picker in here: two 22rem boxes plus five other fields
              overflow a modal panel on a laptop. */}
          <QuestForm
            value={creating}
            onChange={setCreating}
            locations={locations}
            tags={tagItems}
            characters={characterItems}
            pickerHeight="11rem"
          />
          <FormError>{error}</FormError>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              disabled={pending || !creating.title.trim() || !creating.locationId}
              onClick={() => {
                const input = { ...creating };
                setCreating(null);
                run(createQuestAction, input, "Staged. The room is up.");
              }}
            >
              Stage it
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
