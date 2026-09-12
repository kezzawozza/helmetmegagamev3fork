"use client";

import { TableScroll } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Health ------------------------------------------------------------

export function Health({ reconciliation, unattributed, plugRows }) {

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead title="Health" lede="Diagnostics over the ledger — drift, un-hooked call sites, and the backfill seam." />


      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Account drift
        </h3>
        {reconciliation.clean ? (
          <EmptyState>No drift — every account&apos;s ledger legs sum to its live balance.</EmptyState>
        ) : (
          <TableScroll minWidth="30rem">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Kind</th>
                <th scope="col">Live</th>
                <th scope="col">Booked</th>
                <th scope="col">Drift</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.rows.map((r) => (
                <tr key={`${r.kind}:${r.id}`}>
                  <td>{r.name}</td>
                  <td className="text-sm text-muted">{r.kind}</td>
                  <td className="mono">{r.live} ⬢</td>
                  <td className="mono">{r.booked} ⬢</td>
                  <td className="mono text-danger">{r.drift} ⬢</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </div>

      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Unattributed entries by call site
        </h3>
        <p className="ops-lede">
          Every row here is an un-hooked call site — a write that reached the ledger with no reason. This is a to-do
          list, not an error.
        </p>
        {unattributed.length === 0 ? (
          <EmptyState>None — every call site is attributed.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {unattributed.map((u) => (
              <li key={u.actionType} className="flex items-center justify-between gap-3 text-sm">
                <span className="mono">{u.actionType}</span>
                <span className="mono">{u.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Backfill plugs
        </h3>
        <p className="ops-lede">
          What the AuditLog backfill could not account for, per account, written once at the seam before the ledger
          began. Size is a diagnostic, not a number to trust.
        </p>
        {plugRows.length === 0 ? (
          <EmptyState>No plug rows.</EmptyState>
        ) : (
          <TableScroll minWidth="30rem">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Amount</th>
                <th scope="col">Form</th>
              </tr>
            </thead>
            <tbody>
              {plugRows.map((p) => (
                <tr key={p.id}>
                  <td className="text-sm text-muted">{p.fromName ?? "—"}</td>
                  <td className="text-sm text-muted">{p.toName ?? "—"}</td>
                  <td className="mono">{p.amount} ⬢</td>
                  <td className="text-sm text-muted">{p.form}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </div>
    </section>
  );
}
