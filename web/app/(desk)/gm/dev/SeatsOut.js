"use client";

import { useMemo } from "react";
import useNowTick from "@/app/components/useNowTick";
import { EmptyRow } from "@/app/components/EmptyState";
import { useTableState, SortHeader } from "@/app/components/DataTable";
import StatusPill from "@/app/components/StatusPill";

// Seats handed out and not taken up (LOBBY.md). Read-only on purpose: the
// seat expires on its own (db/lib/lobbySweep.js) and re-offering is a
// Start-Game concern — this only answers "who has been told, will they answer".

const COLS = 4;

// "in 4h", "in 20m", or "overdue". Whole units only.
function untilLabel(expiresAt, now) {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "overdue";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export default function SeatsOut({ rows }) {
  const now = useNowTick(60_000);
  // Shared engine, minus the chrome a four-column list doesn't need — just
  // sortable headers (DESIGN-SYSTEM §5). expiresAt may be a Date or ISO string, so normalize to a number for sorting.
  const sortable = useMemo(
    () => rows.map((r) => ({ ...r, expiresAtMs: r.expiresAt ? new Date(r.expiresAt).getTime() : null })),
    [rows],
  );
  const { pageRows, sort, toggleSort } = useTableState({
    rows: sortable,
    searchFields: [(r) => r.handle],
    filterDefs: [],
    initialSort: { key: "expiresAtMs", dir: "asc" },
    pageSize: 500,
  });

  return (
    <table className="data-table">
      <thead>
        <tr>
          <SortHeader label="Player" sortKey="handle" sort={sort} onSort={toggleSort} />
          <SortHeader label="Seat" sortKey="roleName" sort={sort} onSort={toggleSort} />
          <SortHeader label="Answers by" sortKey="expiresAtMs" sort={sort} onSort={toggleSort} />
          <th scope="col">Reminded</th>
        </tr>
      </thead>
      <tbody>
        {pageRows.length === 0 ? (
          <EmptyRow cols={COLS}>Every seat that went out has been taken up.</EmptyRow>
        ) : (
          pageRows.map((r) => {
            const overdue = r.expiresAt && new Date(r.expiresAt).getTime() <= now;
            return (
              <tr key={r.discordUserId}>
                <td>{r.handle}</td>
                <td>{r.roleName}</td>
                <td className="mono">
                  {overdue ? (
                    <StatusPill tone="warn">Overdue</StatusPill>
                  ) : (
                    untilLabel(r.expiresAt, now)
                  )}
                </td>
                <td className="text-muted">{r.reminded ? "yes" : "not yet"}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
