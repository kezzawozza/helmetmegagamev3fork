"use client";

import { useTableState, SortHeader } from "@/app/components/DataTable";
import { EmptyRow } from "@/app/components/EmptyState";
import StatusPill from "@/app/components/StatusPill";
import DiscordAvatar from "@/app/components/DiscordAvatar";
import CharacterLink from "@/app/components/CharacterLink";

// The Gamemaster roster — same table engine and empty state as every other
// list (DESIGN-SYSTEM §5, §5a). No search box or pager: a handful of GMs, a
// filter over six rows is chrome. Sortable headers instead, since "who is a Trial GM" is the real question.

const COLS = 3;

export default function GmRosterTable({ rows }) {
  const { pageRows, sort, toggleSort } = useTableState({
    rows,
    searchFields: [(r) => r.name],
    filterDefs: [],
    initialSort: { key: "name", dir: "asc" },
    pageSize: 500,
  });

  return (
    <table className="data-table">
      <thead>
        <tr>
          <SortHeader label="Gamemaster" sortKey="name" sort={sort} onSort={toggleSort} />
          <SortHeader label="Seat" sortKey="standing" sort={sort} onSort={toggleSort} />
          <th scope="col">Character</th>
        </tr>
      </thead>
      <tbody>
        {pageRows.length === 0 ? (
          <EmptyRow cols={COLS}>
            Nobody holds the Gamemaster or Trial Gamemaster role yet.
          </EmptyRow>
        ) : (
          pageRows.map((m) => (
            <tr key={m.id}>
              <td>
                <span className="flex items-center gap-2">
                  <DiscordAvatar discordUserId={m.id} avatar={m.avatar} name={m.name} />
                  <span>
                    {m.name}
                    {m.handle && <span className="block text-xs text-muted mono">@{m.handle}</span>}
                  </span>
                </span>
              </td>
              <td>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusPill tone={m.tone}>{m.standing}</StatusPill>
                  {m.master && <StatusPill tone="accent">Master</StatusPill>}
                </span>
              </td>
              <td>
                <CharacterLink characterId={m.characterId} name={m.characterName} isGm />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
