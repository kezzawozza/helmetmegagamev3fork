"use client";

import Link from "next/link";
import { StackedArea, Sparkline } from "@/app/components/charts";
import { TableScroll } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Faucets ---------------------------------------------------------------
//
// Every source of new ⬢ — the mirror of Sinks.js.

export function Faucets({ series, categories, table, grandTotal, laborDropRealised, laborDropNote }) {
  return (
    <section className="ops-section ops-section--wide">
      <SectionHead title="Faucets" lede="Every source of new ⬢, over the whole game." />

      {categories.length === 0 ? (
        <EmptyState>No ⬢ has been minted yet.</EmptyState>
      ) : (
        <div className="panel" style={{ padding: "1rem" }}>
          <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
            Income by turn
          </h3>
          <StackedArea series={series} categories={categories} />
        </div>
      )}

      <div className="panel" style={{ padding: "0.75rem 1rem" }}>
        <strong>{laborDropRealised} ⬢</strong> realised from Labor drop.
        <p className="text-xs text-muted" style={{ marginTop: "0.25rem" }}>
          {laborDropNote}
        </p>
      </div>

      {table.length === 0 ? (
        <EmptyState>No faucet reasons recorded.</EmptyState>
      ) : (
        <TableScroll minWidth="34rem">
          <thead>
            <tr>
              <th scope="col">Reason</th>
              <th scope="col">Total</th>
              <th scope="col">Share</th>
              <th scope="col">Trend</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.reason}>
                <td>
                  <Link href={`/gm/economy?s=ledger&reason=${encodeURIComponent(r.reason)}`}>{r.label}</Link>
                </td>
                <td className="mono">{r.total} ⬢</td>
                <td className="mono">{grandTotal > 0 ? `${Math.round(r.share * 100)}%` : "—"}</td>
                <td style={{ width: "6rem" }}>
                  <Sparkline points={r.sparkline} ariaLabel={`${r.label} by turn`} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </section>
  );
}
