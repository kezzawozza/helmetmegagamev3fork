"use client";

import { useEffect, useRef } from "react";
import FactionLink from "@/app/components/FactionLink";
import CharacterLink from "@/app/components/CharacterLink";
import { isUnaffiliated } from "@lifeweb/db/lib/factionConstants";

// The all-factions overview, the Factions tab of the Players panel. Clicking
// a faction's name is the door to /faction's per-faction detail view (member
// roles, add/remove) — this table only shows a member count. highlightFactionId
// comes from outside this tab (`?faction=`, or a FactionLink click) and just marks/scrolls the row.

// Same tint the desk uses for a claimed row — color-mix over --accent-text, no dedicated token for this weight (globals.css).
const HIGHLIGHT_STYLE = { background: "color-mix(in srgb, var(--accent-text) 14%, transparent)" };

function buildChildrenMap(factions) {
  const map = new Map();
  for (const f of factions) {
    const key = f.parentFactionId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

// Renders a faction row plus its subject factions indented beneath, recursively — keeps the hierarchy visible in one flat table.
function FactionRows({ factions, childrenMap, depth, highlightFactionId }) {
  return factions.flatMap((f) => {
    const leader = f.characters.find((c) => c.isLeader);
    const children = childrenMap.get(f.id) ?? [];
    return [
      <tr
        key={f.id}
        id={`faction-row-${f.id}`}
        style={f.id === highlightFactionId ? HIGHLIGHT_STYLE : undefined}
      >
        <td style={{ paddingLeft: `calc(10px + ${depth * 1.25}rem)` }}>
          {depth > 0 ? "↳ " : ""}
          <FactionLink factionId={f.id} name={f.name} />
        </td>
        <td>{f.characters.length}</td>
        <td>
          <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm />
        </td>
      </tr>,
      ...FactionRows({
        factions: children,
        childrenMap,
        depth: depth + 1,
        highlightFactionId,
      }),
    ];
  });
}

export default function FactionsPanel({ factions, highlightFactionId }) {
  const unaffiliated = factions.filter((f) => isUnaffiliated(f));
  const rest = factions.filter((f) => !isUnaffiliated(f));
  const childrenMap = buildChildrenMap(rest);
  const topLevel = rest.filter((f) => !f.parentFactionId);
  const tableRef = useRef(null);

  // Scroll the highlighted row into view whenever the selection changes.
  useEffect(() => {
    if (!highlightFactionId || !tableRef.current) return;
    const row = tableRef.current.querySelector(`#faction-row-${highlightFactionId}`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightFactionId]);

  return (
    <div className="panel overflow-x-auto" ref={tableRef}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Leader</th>
          </tr>
        </thead>
        <tbody>
          {FactionRows({
            factions: topLevel,
            childrenMap,
            depth: 0,
            highlightFactionId,
          })}
          {unaffiliated.map((f) => {
            const leader = f.characters.find((c) => c.isLeader);
            return (
              <tr
                key={f.id}
                id={`faction-row-${f.id}`}
                style={{
                  borderTop: "2px solid var(--border)",
                  ...(f.id === highlightFactionId ? HIGHLIGHT_STYLE : {}),
                }}
              >
                <td>
                  <FactionLink factionId={f.id} name={f.name} />
                </td>
                <td>{f.characters.length}</td>
                <td>
                  <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
