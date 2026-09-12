"use client";

import { useState } from "react";
import { TableScroll } from "@/app/components/DataTable";
import EmptyState from "@/app/components/EmptyState";
import { SectionHead } from "./shared";

// --- Goods -------------------------------------------------------------
//
// The tag catalog against reality: what a priced tag costs, what it sells
// back for, how many exist in the world, and whether anybody has ever
// traded one. `catalog` is goodsCatalog() verbatim — small enough (one row
// per priced tag, not per item) to sort and filter client-side rather than
// server-page like the Ledger or Accounts.

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  depotPrice: (a, b) => (b.depotPrice ?? -1) - (a.depotPrice ?? -1),
  sellablePrice: (a, b) => (b.sellablePrice ?? -1) - (a.sellablePrice ?? -1),
  spread: (a, b) => (b.spread ?? -Infinity) - (a.spread ?? -Infinity),
  inWorld: (a, b) => b.inWorld - a.inWorld,
  traded: (a, b) => b.traded - a.traded,
};

export function Goods({ catalog }) {
  const [sortKey, setSortKey] = useState("inWorld");
  const [filter, setFilter] = useState("all"); // all | profitable | dead

  const squeeze = catalog.find((t) => t.slug === "squeeze");

  // Round-trip profitable: db/lib/syncTags.js only console.warns about a tag
  // priced this way, so it can and does ship — this is the surface that
  // makes the loop visible to a GM instead of leaving it in a build log.
  const rows = catalog.map((t) => ({
    ...t,
    profitable: t.sellablePrice != null && t.depotPrice != null && t.sellablePrice >= t.depotPrice,
    dead: (t.depotPrice != null || t.sellablePrice != null) && t.inWorld > 0 && t.traded === 0,
  }));

  const filtered = rows.filter((r) => {
    if (filter === "profitable") return r.profitable;
    if (filter === "dead") return r.dead;
    return true;
  });
  filtered.sort(SORTS[sortKey] ?? SORTS.inWorld);

  const profitableCount = rows.filter((r) => r.profitable).length;
  const deadCount = rows.filter((r) => r.dead).length;

  return (
    <section className="ops-section ops-section--wide">
      <SectionHead title="Goods" lede="The priced tag catalog against reality: what it costs, what exists, and whether it moves." />

      {squeeze ? (
        <div className="panel" style={{ padding: "0.75rem 1rem" }}>
          <h3 className="text-sm text-muted" style={{ marginBottom: "0.25rem" }}>
            Squeeze — the Factory is where the town&apos;s real surplus comes from
          </h3>
          <SqueezeLine tag={squeeze} />
        </div>
      ) : null}

      <div className="chip-row" role="group" aria-label="Filter">
        <button type="button" className="chip" data-active={filter === "all" || undefined} onClick={() => setFilter("all")}>
          All goods ({rows.length})
        </button>
        <button
          type="button"
          className="chip"
          data-active={filter === "profitable" || undefined}
          onClick={() => setFilter("profitable")}
        >
          Round-trip profitable ({profitableCount})
        </button>
        <button type="button" className="chip" data-active={filter === "dead" || undefined} onClick={() => setFilter("dead")}>
          Dead inventory ({deadCount})
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState>Nothing matches.</EmptyState>
      ) : (
        <TableScroll minWidth="40rem">
          <thead>
            <tr>
              {[
                ["name", "Name"],
                ["depotPrice", "Depot buys at"],
                ["sellablePrice", "Sells back for"],
                ["spread", "Spread"],
                ["inWorld", "In world"],
                ["traded", "Trades"],
              ].map(([key, label]) => (
                <th key={key} scope="col">
                  <button
                    type="button"
                    onClick={() => setSortKey(key)}
                    className="btn-quiet"
                    style={{ padding: 0, font: "inherit" }}
                    aria-current={sortKey === key || undefined}
                  >
                    {label}
                  </button>
                </th>
              ))}
              <th scope="col">Flags</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="mono">{r.depotPrice != null ? `${r.depotPrice} ⬢` : "—"}</td>
                <td className="mono">{r.sellablePrice != null ? `${r.sellablePrice} ⬢` : "—"}</td>
                <td className="mono">{r.spread != null ? `${r.spread} ⬢` : "—"}</td>
                <td className="mono">{r.inWorld}</td>
                <td className="mono">{r.traded}</td>
                <td>
                  {r.profitable ? (
                    <span className="chip" style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
                      round-trip profit
                    </span>
                  ) : null}
                  {r.dead ? <span className="chip text-muted">dead inventory</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </section>
  );
}

function SqueezeLine({ tag }) {
  return (
    <p className="text-sm">
      Depot buys at <span className="mono">{tag.depotPrice != null ? `${tag.depotPrice} ⬢` : "—"}</span>, sells back for{" "}
      <span className="mono">{tag.sellablePrice != null ? `${tag.sellablePrice} ⬢` : "—"}</span> ·{" "}
      <span className="mono">{tag.inWorld}</span> in world · <span className="mono">{tag.traded}</span> trades.
    </p>
  );
}
