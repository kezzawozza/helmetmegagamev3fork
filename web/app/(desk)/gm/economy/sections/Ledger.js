"use client";

import Link from "next/link";
import { TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";
import DiscordTime from "@/app/components/DiscordTime";
import { SectionHead } from "./shared";

// --- Ledger ----------------------------------------------------------------

export function Ledger({ entries, total, allCount, page, pages, reasonFilter, reasonCounts }) {
  const base = "/gm/economy?s=ledger";
  const withReason = (r) => (r ? `${base}&reason=${encodeURIComponent(r)}` : base);
  const pageHref = (p) => `${withReason(reasonFilter)}&page=${p}`;

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead title="Ledger" lede="Every EconomyEntry, newest first." />

      <div className="chip-row" role="group" aria-label="Filter by reason">
        <Link href={base} className="chip" data-active={!reasonFilter || undefined}>
          All ({allCount})
        </Link>
        {reasonCounts.map((r) => (
          <Link
            key={r.reason}
            href={withReason(r.reason)}
            className="chip"
            data-active={reasonFilter === r.reason || undefined}
          >
            {r.label} ({r.count})
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState>No entries for this filter.</EmptyState>
      ) : (
        <TableScroll minWidth="58rem">
          <thead>
            <tr>
              <th scope="col">At</th>
              <th scope="col">Turn</th>
              <th scope="col">Reason</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Amount</th>
              <th scope="col">Form</th>
              <th scope="col">Audit</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">
                  <DiscordTime epoch={e.at} format="f" />
                </td>
                <td className="mono">{e.turnNumber ?? "—"}</td>
                <td>{e.reasonLabel}</td>
                <td>{e.fromName ?? "—"}</td>
                <td>{e.toName ?? "—"}</td>
                <td className="mono">{formatAmount(e)}</td>
                <td className="text-sm text-muted">{e.form}</td>
                <td className="text-sm">
                  {e.auditLogId ? <Link href={`/gm/audit/${e.auditLogId}`}>View</Link> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}

      <Pager
        page={page}
        totalPages={pages}
        total={total}
        unit="entries"
        prevHref={pageHref(Math.max(1, page - 1))}
        nextHref={pageHref(page + 1)}
      />
    </section>
  );
}

// Both the ⬢ value and, when the entry moved goods or coin, what it was — not
// one or the other. A goods/coin row used to print only "3 × bread" and drop
// the ⬢ figure entirely, and a secret row nulls tagSlug (redactEntry), so the
// same kind of entry rendered two different shapes depending on whether it
// was secret.
function formatAmount(e) {
  if (e.tagSlug && e.quantity) return `${e.amount} ⬢ (${e.quantity} × ${e.tagSlug})`;
  if (e.quantity && e.redacted) return `${e.amount} ⬢ (${e.quantity} × item, redacted)`;
  return `${e.amount} ⬢`;
}
