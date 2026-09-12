"use client";

import Link from "next/link";
import { StackedArea, Sparkline } from "@/app/components/charts";
import { TableScroll } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Sinks -------------------------------------------------------------
//
// Every ⬢ that stops existing — the mirror of Faucets.js. SPILLWAY and CLAMP
// get their own callout: unlike every other sink, that ⬢ isn't spent on
// anything, it is simply destroyed, and before the ledger existed neither one
// left any trace at all.

export function Sinks({ series, categories, table, grandTotal }) {
  const destructive = table.filter((r) => r.reason === "SPILLWAY" || r.reason === "CLAMP");
  const spent = table.filter((r) => r.reason !== "SPILLWAY" && r.reason !== "CLAMP");
  const destructiveTotal = destructive.reduce((n, r) => n + r.total, 0);

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead title="Sinks" lede="Every ⬢ that stops existing, over the whole game." />

      {categories.length === 0 ? (
        <EmptyState>No ⬢ has left the world yet.</EmptyState>
      ) : (
        <div className="panel" style={{ padding: "1rem" }}>
          <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
            Outflow by turn
          </h3>
          <StackedArea series={series} categories={categories} />
        </div>
      )}

      <div className="panel" style={{ padding: "0.75rem 1rem", borderColor: "var(--danger)" }}>
        <h3 className="text-sm" style={{ marginBottom: "0.25rem" }}>
          Destroyed outright: <span className="mono text-danger">{destructiveTotal} ⬢</span>
        </h3>
        <p className="text-xs text-muted" style={{ marginBottom: "0.5rem" }}>
          The Spillway and an overdrawn clamp don&apos;t pay for anything — they are the two ways ⬢ simply stops
          existing, and before the ledger, both vanished with no trace at all.
        </p>
        {destructive.length === 0 ? (
          <EmptyState>Nothing destroyed this way yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {destructive.map((r) => (
              <li key={r.reason} className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/gm/economy?s=ledger&reason=${encodeURIComponent(r.reason)}`}>{r.label}</Link>
                <span className="mono">{r.total} ⬢</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {spent.length === 0 ? (
        <EmptyState>No spending recorded.</EmptyState>
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
            {spent.map((r) => (
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
