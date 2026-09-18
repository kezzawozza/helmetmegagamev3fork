"use client";

import EmptyState from "@/app/components/EmptyState";

// Shared bits between the economy desk's sections — pulled out of the old
// single-file EconomyView.js verbatim (see EconomyView.js for the switch that
// dispatches to each section).

export function SectionHead({ title, lede }) {
  return (
    <div className="ops-section-head">
      <h2 className="section-title">{title}</h2>
      {lede ? <p className="ops-lede">{lede}</p> : null}
    </div>
  );
}

export function NotBuilt({ section }) {
  return (
    <section className="ops-section">
      <SectionHead title={sectionTitle(section)} />
      <EmptyState>This section isn&apos;t built yet.</EmptyState>
    </section>
  );
}

export function EmptyGame({ section }) {
  return (
    <section className="ops-section">
      <SectionHead title={sectionTitle(section)} />
      <EmptyState>No current game — there is nothing in the ledger yet.</EmptyState>
    </section>
  );
}

function sectionTitle(section) {
  const titles = {
    pulse: "Pulse",
    ledger: "Ledger",
    accounts: "Accounts",
    health: "Health",
    flows: "Flows",
    faucets: "Faucets",
    sinks: "Sinks",
    goods: "Goods",
    depot: "The Depot",
  };
  return titles[section] ?? section;
}
