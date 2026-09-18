"use client";

import { useState } from "react";
import DepotAtmsTab from "./DepotAtmsTab";
import DepotSellingTab from "./DepotSellingTab";
import DepotBuyingTab from "./DepotBuyingTab";
import DepotManifestsTab from "./DepotManifestsTab";
import DepotPriceListTab from "./DepotPriceListTab";
import DepotLedgerTab from "./DepotLedgerTab";

// The Depot's counter. See docs/systemdocs/DEPOT.md.
//
// A status strip that never leaves the screen, and tabs underneath. The strip
// is down to two things now — your balance and where the train is — because
// those are the two facts that decide whether anything you are about to do
// works, whichever tab you are on. The generator gauge and the turret lamp are
// gone with the generator and with the gun's move onto the office wall.
//
// Nothing here is authoritative. Every disabled control is a hint; the server
// actions re-check the standing, the papers and the money inside their
// transactions, because a disabled input is not a lock.

const TABS = [
  { key: "atms", label: "ATMs" },
  { key: "selling", label: "Selling" },
  { key: "buying", label: "Buying" },
  { key: "manifests", label: "Manifests" },
  { key: "prices", label: "Price list" },
  { key: "ledger", label: "Ledger" },
];

// A train, drawn small. It is the one piece of state a buyer plans around, and
// "arrives at the end of this turn" is the number they actually want.
function TrainStat({ train }) {
  return (
    <span className="depot-stat">
      <span className="depot-stat-label">Train</span>
      <span aria-hidden="true">▤▤▤</span>
      <span className={train?.here ? "text-accent" : "text-muted"}>
        {train?.label ?? "away"} · {train?.nextLabel ?? ""}
      </span>
    </span>
  );
}

export default function DepotConsole(props) {
  const { account, greetingName, atDepot } = props;
  const [tab, setTab] = useState("atms");

  const Body = {
    atms: DepotAtmsTab,
    selling: DepotSellingTab,
    buying: DepotBuyingTab,
    manifests: DepotManifestsTab,
    prices: DepotPriceListTab,
    ledger: DepotLedgerTab,
  }[tab];

  return (
    <div className="flex flex-col gap-4">
      <section className="panel depot-cockpit">
        <div className="depot-cockpit-head">
          <span className="depot-greeting">{greetingName ?? "The Depot."}</span>
          <span className="depot-cockpit-money">
            <span className="depot-balance mono">{account ? `${account.balanceObols} ¢` : "no account"}</span>
          </span>
        </div>
        <div className="depot-cockpit-stats">
          <TrainStat train={props.train} />
        </div>
      </section>

      {!atDepot && <p className="depot-notice">You&apos;re not at the depot.</p>}

      <nav className="tab-bar" aria-label="Depot sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="tab-item"
            data-active={t.key === tab ? "true" : undefined}
            aria-current={t.key === tab ? "page" : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Keyed, so switching tabs resets each one's search box and page
          number rather than carrying a stale filter across. */}
      <Body key={tab} {...props} />
    </div>
  );
}
