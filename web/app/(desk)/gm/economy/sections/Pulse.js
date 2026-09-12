"use client";

import { StackedArea, DivergingBars, Lorenz } from "@/app/components/charts";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Pulse ---------------------------------------------------------------

export function Pulse({ supply, series, gini, lorenz, reconciliation, topMovers, openTurnNumber }) {
  const stackedSeries = [
    { key: "minted", label: "Minted" },
    { key: "moved", label: "Moved" },
    { key: "burned", label: "Burned" },
  ];
  const stackedCategories = series.map((p) => ({
    x: p.turnNumber,
    values: { minted: p.minted, moved: p.moved, burned: p.burned },
  }));
  const divergingPoints = series.map((p) => ({ x: p.turnNumber, positive: p.minted, negative: p.burned }));

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead
        title="Pulse"
        lede="Money supply right now, and how it has moved turn over turn."
      />

      <div className="flex flex-wrap gap-4">
        <SupplyTile label="Balances" value={supply.balance} />
        <SupplyTile label="Coin" value={supply.coin} />
        <SupplyTile label="Depot account" value={supply.account} />
        <SupplyTile label="Depot debt" value={-supply.debt} />
        <SupplyTile label="Manifest" value={supply.manifest} />
        <SupplyTile label="Goods" value={supply.goods} secondary />
        <SupplyTile label="Total supply" value={supply.total} strong />
      </div>

      <ReconciliationBadge reconciliation={reconciliation} />

      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Supply by turn
        </h3>
        <StackedArea series={stackedSeries} categories={stackedCategories} />
      </div>

      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Minted vs. burned
        </h3>
        <DivergingBars points={divergingPoints} />
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="panel" style={{ padding: "1rem", flex: "1 1 18rem" }}>
          <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
            Concentration
          </h3>
          <Lorenz points={lorenz} gini={gini} />
          <p className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
            Covers the living only — a CURSED or DEAD purse would skew inequality toward whoever is left standing,
            so this curve reads differently from the supply and drift totals above, which count every holding
            status.
          </p>
        </div>

        <div className="panel" style={{ padding: "1rem", flex: "1 1 18rem" }}>
          <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
            Top movers{openTurnNumber ? ` — turn ${openTurnNumber}` : ""}
          </h3>
          {topMovers.length === 0 ? (
            <EmptyState>Nobody moved ⬢ this turn.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {topMovers.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{m.name}</span>
                  <span className={`mono ${m.net >= 0 ? "text-positive" : "text-danger"}`}>
                    {m.net >= 0 ? "+" : ""}
                    {m.net} ⬢
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function SupplyTile({ label, value, strong = false, secondary = false }) {
  return (
    <div className="panel" style={{ padding: "0.75rem 1rem", minWidth: "9rem" }}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mono ${strong ? "text-lg" : ""}`} style={secondary ? { opacity: 0.75 } : undefined}>
        {value} ⬢
      </div>
    </div>
  );
}

function ReconciliationBadge({ reconciliation }) {
  if (reconciliation.clean) {
    return <div className="chip" data-active="true">Books balance — every account reconciles</div>;
  }
  // With no ledger history at all, every account "drifts" by its whole
  // balance — that is the pre-ledger seam, not a broken book. Only call it
  // drift once something has actually been booked to compare against.
  if (!reconciliation.backfilled) {
    return (
      <div className="panel" style={{ padding: "0.75rem 1rem" }}>
        Nothing has been booked to the ledger yet — run <code className="mono">db:backfill-economy</code> to give
        every account an opening balance to reconcile against.
      </div>
    );
  }
  return (
    <div className="panel" style={{ padding: "0.75rem 1rem", borderColor: "var(--danger)" }}>
      <strong className="text-danger">{reconciliation.total}</strong> account
      {reconciliation.total === 1 ? "" : "s"} drifted from the ledger, {reconciliation.drift} ⬢ total
      {reconciliation.truncated ? ` (showing the largest ${reconciliation.rows.length})` : ""}. See Health for the
      list.
    </div>
  );
}
