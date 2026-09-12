"use client";

import { TableScroll } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Factions ------------------------------------------------------------
//
// Treasuries, from factionTreasuries() (FACTIONS.md/CARRY.md: there is no
// faction-level balance, only the Room a faction banks in). A faction with
// NO silo gets `siloRoomId: null` / `balance: null` and says so in words —
// that is not the same thing as a silo holding 0 ⬢, and must not render as
// one.
//
// turnIn/turnOut are amounts only, never a counterparty name — there is
// nothing here for redactEntry to withhold from a plain GM, since a cult
// silo's this-turn totals don't name who moved the ⬢.
//
// A per-faction Sparkline of the silo balance over turns would need one
// query per faction (there is no per-turn balance snapshot to group off of
// the way the Ledger's flowsByTurn does) — skipped rather than paying that
// cost per page load.
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
