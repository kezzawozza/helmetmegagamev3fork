"use client";

import { useMemo, useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useTableState, FilterBar } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";
import IconButton from "@/app/components/IconButton";
import ChatMarkdown from "@/app/components/ChatMarkdown";
import { EditIcon, TrashIcon, PinIcon } from "@/app/components/icons";
import { deleteEntry, togglePin } from "./journalActions";

const SEARCH_FIELDS = [(e) => e.title, (e) => e.body, (e) => e.labels.join(" ")];

// DataTable's filterDefs compares one value per row, so a multi-label entry files
// under its FIRST label only — search already covers every label via SEARCH_FIELDS.
const FILTER_DEFS = [{ key: "label", label: "Label", value: (e) => e.labels[0] ?? "" }];

const SORT_OPTIONS = [
  { key: "updatedAtMs", dir: "desc", label: "Newest first" },
  { key: "updatedAtMs", dir: "asc", label: "Oldest first" },
  { key: "turnNumber", dir: "desc", label: "Latest turn" },
];

// A body long enough to want a fold. Mirrors ExpandableText.js's character-count heuristic,
// but clamps around a rendered body instead of a plain string. Goes through ChatMarkdown,
// not RichText — RichText is the FULL catalog resolver, and a player could type
// {tag:apex-form} into their own journal and mint a live chip out of it.
function EntryBody({ text }) {
  const [open, setOpen] = useState(false);
  const clean = (text ?? "").trim();
  if (!clean) return null;

  const overflows = clean.length > 320 || clean.split("\n").length > 4;
  if (!overflows) {
    return (
      <div className="text-sm">
        <ChatMarkdown content={clean} />
      </div>
    );
  }

  return (
    <>
      <div
        className="text-sm"
        style={
          open
            ? undefined
            : { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 4, overflow: "hidden" }
        }
      >
        <ChatMarkdown content={clean} />
      </div>
      <button type="button" className="btn-quiet" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Less" : "More"}
      </button>
    </>
  );
}

export default function JournalList({ entries, onEdit }) {
  const confirm = useConfirm();
  const [removed, setRemoved] = useState(new Set());
  const [pendingPins, setPendingPins] = useState(new Map()); // id -> optimistic pinned
  const [, startTransition] = useTransition();

  const filterDefs = useMemo(() => FILTER_DEFS, []);
  const searchFields = useMemo(() => SEARCH_FIELDS, []);
  const rows = useMemo(
    () =>
      entries
        .filter((e) => !removed.has(e.id))
        .map((e) => (pendingPins.has(e.id) ? { ...e, pinned: pendingPins.get(e.id) } : e)),
    [entries, removed, pendingPins],
  );

  const { query, setQuery, filters, setFilters, sort, setSort, options, visible, page, setPage, total, totalPages } =
    useTableState({
      rows,
      filterDefs,
      searchFields,
      initialSort: { key: "updatedAtMs", dir: "desc" },
    });

  // Pinned entries float to the top; sorted on a copy since `visible` may be === `rows`.
  const pageSize = 50;
  const ordered = useMemo(() => [...visible].sort((a, b) => Number(b.pinned) - Number(a.pinned)), [visible]);
  const pageRows = ordered.slice((page - 1) * pageSize, page * pageSize);

  async function handleDelete(entry) {
    if (
      !(await confirm({
        title: `Delete "${entry.title}"?`,
        message: "This can't be undone.",
        confirmLabel: "Delete",
      }))
    )
      return;
    setRemoved((prev) => new Set(prev).add(entry.id));
    startTransition(() => {
      deleteEntry(entry.id);
    });
  }

  function handleTogglePin(entry) {
    const next = !entry.pinned;
    setPendingPins((prev) => new Map(prev).set(entry.id, next));
    startTransition(async () => {
      const res = await togglePin(entry.id, next);
      // A failure reverts the optimistic override; the next server read is the truth.
      if (!res?.ok) {
        setPendingPins((prev) => {
          const next = new Map(prev);
          next.delete(entry.id);
          return next;
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filterDefs={filterDefs}
        filters={filters}
        setFilters={setFilters}
        options={options}
        query={query}
        setQuery={setQuery}
        searchLabel="Search entries"
        sortOptions={SORT_OPTIONS}
        sort={sort}
        setSort={setSort}
      />

      <div className="list-scroll flex flex-col gap-3">
        {pageRows.map((entry) => (
          <div key={entry.id} className="panel flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="section-title">{entry.title}</h3>
              <div className="flex items-center gap-1">
                <IconButton
                  icon={PinIcon}
                  label={entry.pinned ? "Unpin" : "Pin to top"}
                  aria-pressed={entry.pinned}
                  onClick={() => handleTogglePin(entry)}
                />
                <IconButton icon={EditIcon} label="Edit entry" onClick={() => onEdit(entry)} />
                <IconButton icon={TrashIcon} label="Delete entry" onClick={() => handleDelete(entry)} />
              </div>
            </div>
            <div className="text-xs text-muted">
              {entry.turnNumber != null ? `Turn ${entry.turnNumber}` : null}
              {entry.turnNumber != null ? " · " : null}
              edited {new Date(entry.updatedAt).toLocaleString()}
            </div>
            <EntryBody text={entry.body} />
            {entry.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {entry.labels.map((label) => (
                  <span key={label} className="chip">
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {pageRows.length === 0 && <EmptyState>No journal entries match these filters.</EmptyState>}
      </div>

      <Pager page={page} totalPages={totalPages} total={total} unit="entries" onPage={setPage} />
    </div>
  );
}
