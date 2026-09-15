"use client";

import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";

// The read-only twin of StructuresTable: no verbs, because there is no
// mechanical reversal to offer — a GM repairing a craft works by hand on the
// Dev Panel, and this table's job is to hand them the numbers (the Spent
// column above all).

const STATUS_LABELS = {
  ACTIVE: "In progress",
  DONE: "Finished",
  CANCELLED: "Given up",
};

const FILTER_DEFS = [
  { key: "status", label: "Status", value: (row) => STATUS_LABELS[row.status] ?? row.status },
];

export default function CraftsTable({ projects }) {
  const table = useTableState({
    rows: projects,
    searchFields: [
      (row) => row.characterName,
      (row) => row.tagName,
      (row) => row.customName,
      (row) => row.payerName,
    ],
    filterDefs: FILTER_DEFS,
    initialSort: { key: "createdAtMs", dir: "desc" },
  });

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filterDefs={FILTER_DEFS}
        filters={table.filters}
        setFilters={table.setFilters}
        options={table.options}
        query={table.query}
        setQuery={table.setQuery}
        searchLabel="Search"
        searchPlaceholder="Character, recipe, custom name…"
      />
      <TableScroll minWidth="64rem">
        <thead>
          <tr>
            <SortHeader label="Who" sortKey="characterName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Making" sortKey="tagName" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Work</th>
            <th scope="col">Paid</th>
            <th scope="col">Spent</th>
            <th scope="col">Turns</th>
          </tr>
        </thead>
        <tbody>
          {table.pageRows.map((row) => (
            <tr key={row.id}>
              <td>{row.characterName}</td>
              <td>
                {row.quantity > 1 ? `${row.quantity}× ` : ""}
                {row.tagName}
                {row.customName ? (
                  <span className="text-muted"> — &quot;{row.customName}&quot;</span>
                ) : null}
              </td>
              <td>{STATUS_LABELS[row.status] ?? row.status}</td>
              <td className="mono">
                {row.turnsDone}/{row.turnsNeeded}
              </td>
              <td>
                {row.resourcesCost > 0 ? (
                  <>
                    <span className="mono">{row.resourcesCost} ⬢</span>
                    <span className="text-muted"> — {row.payerName}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>{row.spent || "—"}</td>
              <td className="mono">
                {row.startedTurn ?? "—"}
                {row.lastTurn != null && row.lastTurn !== row.startedTurn ? `→${row.lastTurn}` : ""}
              </td>
            </tr>
          ))}
          {table.pageRows.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted">
                Nobody has a craft project going.
              </td>
            </tr>
          )}
        </tbody>
      </TableScroll>
      <Pager page={table.page} totalPages={table.totalPages} onPage={table.setPage} total={table.total} />
    </div>
  );
}
