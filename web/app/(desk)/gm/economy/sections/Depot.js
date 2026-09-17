"use client";

import { DivergingBars } from "@/app/components/charts";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- The Depot -----------------------------------------------------------
// `books` is depotBooks() — nulls, not zeros, when there's no Depot row, so
// this can say "not provisioned" rather than draw an empty ledger.
//
// DEPOT.md §0g: a bank account and the coin behind it are TWO POTS, never
// summed. The number worth reading first is the BACKING — the Vault's coin
// against what the Treasury accounts claim. Under it, somebody is going to walk
// up to the ATM and be told no, and that is a finding rather than a bug in the
// books (ECONOMY.md §3).
export function Depot({ books, trainHere, tradePoints }) {
  if (books.claimsObols == null) {
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
  const claims = books.treasuryClaims ?? 0;
  const vault = books.vaultObols ?? 0;
  const backingPct = claims > 0 ? Math.min(100, Math.round((vault / claims) * 100)) : 100;
  const short = vault < claims;

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead
        title="The Depot"
        lede="Every account in the game, and the coin in the Keep's Vault standing behind the Treasury ones."
      />

      <div className="panel" style={{ padding: "1rem", display: "flex", flexWrap: "wrap", gap: "2rem" }}>
        <dl className="depot-totals">
          <div>
            <dt>Treasury claims</dt>
            <dd className="mono">{claims} ¢</dd>
          </div>
          <div>
            <dt>Offshore claims</dt>
            <dd className="mono">{books.offshoreClaims ?? 0} ¢</dd>
          </div>
          <div>
            <dt>Credit available</dt>
            <dd className="mono">{books.creditAvailableObols} ¢</dd>
          </div>
        </dl>

        <div style={{ minWidth: "14rem" }}>
          <div className="text-sm text-muted" style={{ marginBottom: "0.25rem" }}>
            Debt drawn: {debt} / {cap} ¢
          </div>
          <div className="depot-meter" role="img" aria-label={`${debt} of ${cap} obols drawn`}>
            <span className="depot-meter-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div style={{ minWidth: "14rem" }}>
          <div className={short ? "text-sm text-danger" : "text-sm text-muted"} style={{ marginBottom: "0.25rem" }}>
            Vault backing: {vault} / {claims} ¢{short ? " — short" : ""}
          </div>
          <div className="depot-meter" role="img" aria-label={`${vault} of ${claims} obols backed`}>
            <span className="depot-meter-fill" style={{ width: `${backingPct}%` }} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: "0.75rem 1rem" }}>
        <dl className="depot-totals">
          <div>
            <dt>On the rails</dt>
            <dd className="mono">
              {books.manifestLines} line{books.manifestLines === 1 ? "" : "s"} · {books.manifestValue} ⬢
            </dd>
          </div>
          <div>
            <dt>Train</dt>
            <dd>{trainHere ? "at the platform" : "down the line"}</dd>
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
