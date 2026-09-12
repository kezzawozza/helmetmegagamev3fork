"use client";

import Link from "next/link";
import { Sankey, ArcWeb } from "@/app/components/charts";
import { TableScroll } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Flows -----------------------------------------------------------------
//
// The panel this whole desk was asked for: where ⬢ comes from, where it ends
// up, and who traded with whom, over a turn range picked with plain link
// chips (no client state — a reload or a shared URL reproduces the same view).

export function Flows({ sankey, arcWeb, reasonRows, minTurn, maxTurn, fromTurn, toTurn }) {
  const rangeHref = (from, to) => `/gm/economy?s=flows&from=${from}&to=${to}`;

  // A handful of even-width slices across the game's whole turn range, plus
  // "All". Enough to move around without a form to fill in.
  const span = Math.max(0, maxTurn - minTurn);
  const presets =
    span >= 3
      ? [
          { label: "First half", from: minTurn, to: minTurn + Math.floor(span / 2) },
          { label: "Second half", from: minTurn + Math.floor(span / 2) + 1, to: maxTurn },
          { label: "Last 5 turns", from: Math.max(minTurn, maxTurn - 4), to: maxTurn },
        ]
      : [];

  const noData = sankey.nodes.length === 0 && reasonRows.length === 0;

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead
        title="Flows"
        lede="Faucets in, sinks out, and who traded with whom, over a turn range."
      />

      <div className="chip-row" role="group" aria-label="Turn range">
        <Link href={rangeHref(minTurn, maxTurn)} className="chip" data-active={fromTurn === minTurn && toTurn === maxTurn ? "true" : undefined}>
          All (turns {minTurn}–{maxTurn})
        </Link>
        {presets.map((p) => (
          <Link
            key={p.label}
            href={rangeHref(p.from, p.to)}
            className="chip"
            data-active={fromTurn === p.from && toTurn === p.to ? "true" : undefined}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {noData ? (
        <EmptyState>No faucet or sink activity in turns {fromTurn}–{toTurn}.</EmptyState>
      ) : (
        <>
          <div className="panel" style={{ padding: "1rem" }}>
            <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
              Faucets → accounts → sinks
            </h3>
            <Sankey nodes={sankey.nodes} links={sankey.links} />
          </div>

          <div className="panel" style={{ padding: "1rem" }}>
            <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
              Who traded with whom
            </h3>
            <ArcWeb nodes={arcWeb.nodes} links={arcWeb.links} />
          </div>

          {reasonRows.length === 0 ? null : (
            <TableScroll minWidth="32rem">
              <thead>
                <tr>
                  <th scope="col">Reason</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {reasonRows.map((r) => (
                  <tr key={r.reason}>
                    <td>
                      <Link href={`/gm/economy?s=ledger&reason=${encodeURIComponent(r.reason)}`}>{r.label}</Link>
                    </td>
                    <td className="text-sm text-muted">{r.flow === "FAUCET" ? "Faucet" : "Sink"}</td>
                    <td className="mono">{r.amount} ⬢</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          )}
        </>
      )}
    </section>
  );
}
