"use client";

import Link from "next/link";
import { TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";
import ResourceChip from "@/app/components/ResourceChip";
import { SectionHead } from "./shared";

// --- Accounts --------------------------------------------------------------

// Server-paged, the same posture as the Ledger and /gm/audit. This used to
// load every character AND every room and hand the whole thing to
// useTableState to page client-side — Rooms are unbounded and grow with every
// zone re-sync, so that payload only ever got bigger. `apage` (rather than
// `page`) so this section's paging doesn't collide with the Ledger's when a
// GM has both open — they don't share a search param.
export function Accounts({ rows, total, page, pages, kindFilter, zoneFilter, q, zoneOptions, openTurnNumber }) {
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
