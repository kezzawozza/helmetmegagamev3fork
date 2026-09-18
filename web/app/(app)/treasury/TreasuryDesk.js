"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import { FilterBar, TableScroll, SortHeader, useTableState } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import { setSellTaxRate } from "./actions";

// Three numbers and a table. The one worth reading first is the backing: the
// Vault's coin against the sum of what the Treasury accounts claim. Under it,
// somebody is going to walk up to the ATM and be told no.
const SEARCH_FIELDS = [(r) => r.holderName, (r) => r.fingerprint, (r) => r.roleName];
const FILTER_DEFS = [
  { key: "class", label: "Class", value: (r) => r.class },
  { key: "role", label: "Role", value: (r) => r.roleName ?? "" },
];

export default function TreasuryDesk({ rate, vaultObols, claims, stagedValue, accounts, readOnly }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(String(rate));
  const [error, setError] = useState(null);

  const table = useTableState({
    rows: accounts,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "balanceObols", dir: "desc" },
  });

  function save() {
    startTransition(async () => {
      const result = await setSellTaxRate({ rate: Number(draft) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      refresh();
    });
  }

  const short = vaultObols < claims;

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-5">
        <dl className="depot-totals">
          <div className={short ? "text-danger" : undefined}>
            <dt>In the treasury</dt>
            <dd className="mono">{vaultObols} ¢</dd>
          </div>
          <div>
            <dt>Claimed against it</dt>
            <dd className="mono">{claims} ¢</dd>
          </div>
          <div>
            <dt>Staged to sell</dt>
            <dd className="mono">{stagedValue} ¢</dd>
          </div>
        </dl>
        {short && (
          <p className="mt-3 text-sm text-danger">
            The treasury holds less than the accounts claim — withdrawals will be refused.
          </p>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">Sell tax</h2>
        <div className="mt-4 flex items-end gap-2">
          <label className="field">
            <span>Rate, percent</span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft}
              disabled={readOnly || pending}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <button type="button" className="btn" disabled={readOnly || pending} onClick={save}>
            Set it
          </button>
        </div>
        <p className="mt-3 text-sm text-muted">
          Taken off every sale before the seller is paid, into the treasury as coin.
        </p>
        {readOnly && <p className="mt-2 text-sm text-muted">Read-only — you must be at the terminal to change it.</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">Accounts</h2>
        <div className="mt-4 flex flex-col gap-3">
          <FilterBar
            filterDefs={FILTER_DEFS}
            filters={table.filters}
            setFilters={table.setFilters}
            options={table.options}
            query={table.query}
            setQuery={table.setQuery}
            searchLabel="Search accounts"
          />
          <TableScroll minWidth="36rem">
            <thead>
              <tr>
                <SortHeader label="Holder" sortKey="holderName" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Fingerprint" sortKey="fingerprint" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Role" sortKey="roleName" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Class" sortKey="class" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Balance" sortKey="balanceObols" sort={table.sort} onSort={table.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {table.pageRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.holderName}</td>
                  <td className="mono text-muted">{row.fingerprint}</td>
                  <td className="text-muted">{row.roleName || "—"}</td>
                  <td className="text-muted">{row.class === "OFFSHORE" ? "Offshore" : "Treasury"}</td>
                  <td className="mono">{row.balanceObols} ¢</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
          <Pager
            page={table.page}
            totalPages={table.totalPages}
            total={table.total}
            unit="accounts"
            onPage={table.setPage}
          />
        </div>
      </section>
    </div>
  );
}
