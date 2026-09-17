"use client";

import { useMemo, useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotOrder } from "@/app/(app)/depot/actions";
import { FilterBar, TableScroll, SortHeader, useTableState } from "./DataTable";
import Pager from "./Pager";
import RequestDialog from "./RequestDialog";
import TagChip from "./TagChip";

// What you may order, which is not what the station stocks.
//
// The rows are filtered to the manifests your own tags open
// (db/lib/depotManifests.js), so most people see a short list and a Merchant
// sees everything. The gate is re-checked server-side on every line of the
// cart — the Kind filter here is a convenience, not the rule.
const SEARCH_FIELDS = [(r) => r.name, (r) => r.description];
const FILTER_DEFS = [
  { key: "manifest", label: "Manifest", value: (r) => r.manifest ?? "" },
  { key: "group", label: "Kind", value: (r) => r.groupName ?? "" },
];

export default function DepotBuyingTab({ wares, openManifests, account, train, disabled }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [cart, setCart] = useState(() => new Map());
  const [anonymous, setAnonymous] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  // Only what this character's shelves hold. Everything else is not greyed —
  // it is simply not offered, the same call the verb strip makes about a verb
  // that is a fact of somebody else's sheet.
  const offered = useMemo(
    () => wares.filter((w) => openManifests.includes(w.manifest)),
    [wares, openManifests],
  );

  const table = useTableState({
    rows: offered,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "price", dir: "asc" },
  });

  const cartLines = useMemo(
    () =>
      [...cart.entries()]
        .map(([id, quantity]) => ({ ...offered.find((w) => w.id === id), quantity }))
        .filter((l) => l.id && l.quantity > 0),
    [cart, offered],
  );
  const cartTotal = cartLines.reduce((s, l) => s + l.price * l.quantity, 0);
  const balance = account?.balanceObols ?? 0;
  const after = balance - cartTotal;
  const affordable = Boolean(account) && after >= 0;

  function bump(id, delta) {
    setCart((prev) => {
      const next = new Map(prev);
      const n = (next.get(id) ?? 0) + delta;
      if (n <= 0) next.delete(id);
      else next.set(id, Math.min(99, n));
      return next;
    });
  }

  function submit(reason) {
    startTransition(async () => {
      const result = await depotOrder({
        items: cartLines.map((l) => ({ tagId: l.id, quantity: l.quantity })),
        anonymous,
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCart(new Map());
      setConfirming(false);
      refresh();
    });
  }

  return (
    <div className="depot-split">
      <section className="panel p-5">
        <h2 className="panel-header">Buying</h2>

        <div className="mt-4 flex flex-col gap-3">
          <FilterBar
            filterDefs={FILTER_DEFS}
            filters={table.filters}
            setFilters={table.setFilters}
            options={table.options}
            query={table.query}
            setQuery={table.setQuery}
            searchLabel="Search wares"
          />

          <TableScroll minWidth="38rem">
            <thead>
              <tr>
                <SortHeader label="Ware" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Buy" sortKey="price" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Sells back" sortKey="sellPrice" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Held" sortKey="held" sort={table.sort} onSort={table.toggleSort} />
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {table.pageRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {/* The ⬢ row has no Tag behind it, so it renders as a plain name rather than a chip. */}
                    {row.synthetic ? <span>{row.name}</span> : <TagChip tag={row.tag} />}
                    {row.sealed && <span className="depot-seal">SEALED</span>}
                  </td>
                  <td className="mono">{row.price} ¢</td>
                  <td className="mono text-muted">{row.sellPrice != null ? `${row.sellPrice} ¢` : "—"}</td>
                  <td className="mono text-muted">{row.held || "—"}</td>
                  <td className="depot-stepper-cell">
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={disabled || !cart.get(row.id)}
                      onClick={() => bump(row.id, -1)}
                      aria-label={`One fewer ${row.name}`}
                    >
                      −
                    </button>
                    <span className="mono depot-stepper-count">{cart.get(row.id) ?? 0}</span>
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={disabled}
                      onClick={() => bump(row.id, 1)}
                      aria-label={`One more ${row.name}`}
                    >
                      +
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
          <Pager page={table.page} totalPages={table.totalPages} total={table.total} unit="wares" onPage={table.setPage} />
        </div>
      </section>

      <section className="panel p-5 depot-aside">
        <h2 className="panel-header">Your order</h2>

        {cartLines.length > 0 && (
          <ul className="depot-list mt-3">
            {cartLines.map((l) => (
              <li key={l.id}>
                <span>{l.name}</span>
                <span className="mono">
                  ×{l.quantity} · {l.price * l.quantity} ¢
                </span>
              </li>
            ))}
          </ul>
        )}

        <dl className="depot-totals">
          <div>
            <dt>Order</dt>
            <dd className="mono">{cartTotal} ¢</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd className="mono">{account ? `${balance} ¢` : "—"}</dd>
          </div>
          <div className={affordable || !cartLines.length ? undefined : "text-danger"}>
            <dt>After</dt>
            <dd className="mono">{account ? `${after} ¢` : "—"}</dd>
          </div>
        </dl>

        <label className="field mt-3">
          <span>Crate label</span>
          <select value={anonymous ? "anon" : "name"} onChange={(e) => setAnonymous(e.target.value === "anon")}>
            <option value="name">Print my name on it</option>
            <option value="anon">Leave it off</option>
          </select>
        </label>

        <button
          type="button"
          className="btn mt-4"
          disabled={disabled || pending || !cartLines.length || !affordable}
          onClick={() => setConfirming(true)}
        >
          Place order
        </button>

        {!account && <p className="mt-3 text-sm text-muted">Open an account on the ATMs tab first.</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      {confirming && (
        <RequestDialog
          open
          title="Place the order"
          submitLabel="Order"
          busy={pending}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={submit}
        >
          <p className="text-sm text-muted">
            {cartTotal} ¢ comes out now. It arrives as crates in the Railyard — the train{" "}
            {train?.nextLabel ?? "arrives on its next run"}.
          </p>
        </RequestDialog>
      )}
    </div>
  );
}
