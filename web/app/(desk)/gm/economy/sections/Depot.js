"use client";

import { DivergingBars } from "@/app/components/charts";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- The Depot -----------------------------------------------------------
// `books` is depotBooks() — nulls, not zeros, when there's no Depot row, so
// this can say "not provisioned" rather than draw an empty ledger. DEPOT.md
// §0g: the station's account and the Merchant's own purse are TWO POTS, the
// ATM the only door between them — this section never sums them.
export function Depot({ books, generatorOn, generatorFuel, fuelMax, shuttleState, tradePoints }) {
  if (books.accountObols == null) {
    return (
      <section className="ops-section ops-section--wide">
        <SectionHead title="The Depot" />
        <EmptyState>No Depot row exists yet — the station hasn&apos;t been provisioned.</EmptyState>
      </section>
    );
  }

  const debt = books.debtObols ?? 0;
  const cap = books.creditCapObols ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((debt / cap) * 100)) : 0;
  const fuelPct = fuelMax > 0 ? Math.min(100, Math.round((generatorFuel / fuelMax) * 100)) : 0;

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead
        title="The Depot"
        lede="The station's own books — separate from the Merchant's pocket. The ATM is the only door between them."
      />

      <div className="panel" style={{ padding: "1rem", display: "flex", flexWrap: "wrap", gap: "2rem" }}>
        <dl className="depot-totals">
          <div>
            <dt>Station account</dt>
            <dd className="mono">{books.accountObols} ⬢</dd>
          </div>
          <div>
            <dt>Credit available</dt>
            <dd className="mono">{books.creditAvailableObols} ⬢</dd>
          </div>
        </dl>

        <div style={{ minWidth: "14rem" }}>
          <div className="text-sm text-muted" style={{ marginBottom: "0.25rem" }}>
            Debt drawn: {debt} / {cap} ⬢
          </div>
          <div className="depot-meter" role="img" aria-label={`${debt} of ${cap} obols drawn`}>
            <span className="depot-meter-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div style={{ minWidth: "14rem" }}>
          <div className="text-sm text-muted" style={{ marginBottom: "0.25rem" }}>
            Generator fuel: {generatorFuel} / {fuelMax} — {generatorOn ? "running" : "off"}
          </div>
          <div className="depot-meter" role="img" aria-label={`${generatorFuel} of ${fuelMax} fuel`}>
            <span className="depot-meter-fill" style={{ width: `${fuelPct}%` }} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: "0.75rem 1rem" }}>
        <dl className="depot-totals">
          <div>
            <dt>Manifest in flight</dt>
            <dd className="mono">
              {books.manifestLines} line{books.manifestLines === 1 ? "" : "s"} · {books.manifestValue} ⬢
            </dd>
          </div>
          <div>
            <dt>Shuttle</dt>
            <dd>{shuttleState ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Balance of trade, by turn — orders paid in, sales paid out
        </h3>
        <DivergingBars points={tradePoints} />
      </div>
    </section>
  );
}
