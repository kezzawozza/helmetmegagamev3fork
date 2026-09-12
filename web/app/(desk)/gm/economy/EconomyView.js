"use client";

import Link from "next/link";
import { StackedArea, DivergingBars, Lorenz } from "@/app/components/charts";
import { TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";
import ResourceChip from "@/app/components/ResourceChip";
import DiscordTime from "@/app/components/DiscordTime";

// The economy desk's whole client half. One file, one switch on `section` —
// the four sections are short enough that splitting each into its own
// component would mean four files that each import half of DataTable and
// none of them big enough to be worth the indirection.
//
// Rendered by SnapshotPage (see page.js): every prop here is the DTO
// FreshEconomy built server-side, already redacted and zone-scoped where
// that applies. Nothing here talks to Prisma.
export default function EconomyView(props) {
  if (props.empty) return <EmptyGame section={props.section} />;
  if (props.notBuilt) return <NotBuilt section={props.section} />;

  switch (props.section) {
    case "pulse":
      return <Pulse {...props} />;
    case "ledger":
      return <Ledger {...props} />;
    case "accounts":
      return <Accounts {...props} />;
    case "health":
      return <Health {...props} />;
    default:
      return <NotBuilt section={props.section} />;
  }
}

function SectionHead({ title, lede }) {
  return (
    <div className="ops-section-head">
      <h2 className="section-title">{title}</h2>
      {lede ? <p className="ops-lede">{lede}</p> : null}
    </div>
  );
}

function NotBuilt({ section }) {
  return (
    <section className="ops-section">
      <SectionHead title={sectionTitle(section)} />
      <EmptyState>This section isn&apos;t built yet.</EmptyState>
    </section>
  );
}

function EmptyGame({ section }) {
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
    factions: "Factions",
  };
  return titles[section] ?? section;
}

// --- Pulse ---------------------------------------------------------------

function Pulse({ supply, series, gini, lorenz, reconciliation, topMovers, openTurnNumber }) {
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

// --- Ledger ----------------------------------------------------------------

function Ledger({ entries, total, allCount, page, pages, reasonFilter, reasonCounts }) {
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

// --- Accounts --------------------------------------------------------------

// Server-paged, the same posture as the Ledger and /gm/audit. This used to
// load every character AND every room and hand the whole thing to
// useTableState to page client-side — Rooms are unbounded and grow with every
// zone re-sync, so that payload only ever got bigger. `apage` (rather than
// `page`) so this section's paging doesn't collide with the Ledger's when a
// GM has both open — they don't share a search param.
function Accounts({ rows, total, page, pages, kindFilter, zoneFilter, q, zoneOptions, openTurnNumber }) {
  const base = "/gm/economy?s=accounts";
  const withParams = (overrides = {}) => {
    const params = new URLSearchParams();
    const kind = "kind" in overrides ? overrides.kind : kindFilter;
    const zone = "zone" in overrides ? overrides.zone : zoneFilter;
    const query = "q" in overrides ? overrides.q : q;
    const apage = "apage" in overrides ? overrides.apage : null;
    if (kind) params.set("kind", kind);
    if (zone) params.set("zone", zone);
    if (query) params.set("q", query);
    if (apage) params.set("apage", apage);
    const qs = params.toString();
    return qs ? `${base}&${qs}` : base;
  };
  const pageHref = (p) => withParams({ apage: p });

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead
        title="Accounts"
        lede={
          openTurnNumber
            ? `Every character and room, with what moved this turn (turn ${openTurnNumber}).`
            : "Every character and room. No turn is open, so inflow/outflow read 0."
        }
      />

      <div className="chip-row" role="group" aria-label="Filter by kind">
        <Link href={withParams({ kind: null })} className="chip" data-active={!kindFilter || undefined}>
          All kinds
        </Link>
        {["character", "room"].map((k) => (
          <Link key={k} href={withParams({ kind: k })} className="chip" data-active={kindFilter === k || undefined}>
            {k === "character" ? "Characters" : "Rooms"}
          </Link>
        ))}
      </div>

      {zoneOptions.length > 0 ? (
        <div className="chip-row" role="group" aria-label="Filter by zone">
          <Link href={withParams({ zone: null })} className="chip" data-active={!zoneFilter || undefined}>
            All zones
          </Link>
          {zoneOptions.map((z) => (
            <Link key={z} href={withParams({ zone: z })} className="chip" data-active={zoneFilter === z || undefined}>
              {z}
            </Link>
          ))}
        </div>
      ) : null}

      <AccountSearch base={base} kindFilter={kindFilter} zoneFilter={zoneFilter} q={q} />

      {rows.length === 0 ? (
        <EmptyState>Nothing matches.</EmptyState>
      ) : (
        <TableScroll minWidth="40rem">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Zone</th>
              <th scope="col">Balance</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}:${r.id}`}>
                <td>{r.name}</td>
                <td className="text-sm text-muted">{r.kind}</td>
                <td className="text-sm text-muted">{r.zoneName || "—"}</td>
                <td>
                  <ResourceChip value={r.balance} />
                </td>
                <td className="mono text-positive">{r.inflow ? `+${r.inflow}` : "0"}</td>
                <td className="mono text-danger">{r.outflow ? `-${r.outflow}` : "0"}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}

      <Pager
        page={page}
        totalPages={pages}
        total={total}
        prevHref={pageHref(Math.max(1, page - 1))}
        nextHref={pageHref(page + 1)}
      />
    </section>
  );
}

// A plain GET form rather than a controlled input with client state: this
// section is server-paged now, so "search" means "navigate with ?q=", the
// same way the Ledger's reason chips are links rather than client filters.
function AccountSearch({ base, kindFilter, zoneFilter, q }) {
  return (
    <form action={base} method="get" className="flex items-center gap-2" style={{ maxWidth: "24rem" }}>
      <input type="hidden" name="s" value="accounts" />
      {kindFilter ? <input type="hidden" name="kind" value={kindFilter} /> : null}
      {zoneFilter ? <input type="hidden" name="zone" value={zoneFilter} /> : null}
      <label className="field" style={{ flex: 1 }}>
        <span className="sr-only">Search by name</span>
        <input type="text" name="q" defaultValue={q} placeholder="A character or room…" />
      </label>
      <button type="submit" className="btn">
        Search
      </button>
    </form>
  );
}

// --- Health ------------------------------------------------------------

function Health({ reconciliation, unattributed, plugRows }) {

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
