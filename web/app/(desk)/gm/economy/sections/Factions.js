"use client";

import { TableScroll } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Factions ------------------------------------------------------------
// Treasuries, from factionTreasuries() (FACTIONS.md/CARRY.md: no
// faction-level balance, only the Room a faction banks in). A faction with
// NO silo gets `siloRoomId: null` / `balance: null` and says so in words —
// must not render as a silo holding 0 ⬢. turnIn/turnOut are amounts only,
// never a counterparty name. A per-faction Sparkline is skipped — it would
// need one query per faction with no per-turn snapshot to group off of.
export function Factions({ factions, openTurnNumber }) {
  return (
    <section className="ops-section ops-section--wide">
      <SectionHead
        title="Factions"
        lede={
          openTurnNumber
            ? `Every faction's silo, with what moved in and out this turn (turn ${openTurnNumber}).`
            : "Every faction's silo. No turn is open, so in/out read 0."
        }
      />

      {factions.length === 0 ? (
        <EmptyState>No factions exist yet.</EmptyState>
      ) : (
        <TableScroll minWidth="38rem">
          <thead>
            <tr>
              <th scope="col">Faction</th>
              <th scope="col">Zone</th>
              <th scope="col">Members</th>
              <th scope="col">Silo balance</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
            </tr>
          </thead>
          <tbody>
            {factions.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td className="text-sm text-muted">{f.zoneName || "—"}</td>
                <td className="mono">{f.memberCount}</td>
                <td className="mono">
                  {f.siloRoomId == null ? <span className="text-muted">no silo</span> : `${f.balance} ⬢`}
                </td>
                <td className="mono text-positive">{f.turnIn ? `+${f.turnIn}` : "0"}</td>
                <td className="mono text-danger">{f.turnOut ? `-${f.turnOut}` : "0"}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </section>
  );
}
