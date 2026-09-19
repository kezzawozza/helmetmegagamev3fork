"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRefresh } from "@/app/components/useRefresh";
import { FilterBar, TableScroll, SortHeader, useTableState } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import InfoIcon from "@/app/components/InfoIcon";
import { setSellTaxRate } from "./actions";

// Three numbers and a table. The one worth reading first is the backing: the
// Vault's coin against the sum of what the Treasury accounts claim. Under it,
// somebody is going to walk up to the ATM and be told no.
const SEARCH_FIELDS = [(r) => r.holderName, (r) => r.fingerprint, (r) => r.roleName];
const FILTER_DEFS = [
  { key: "class", label: "Class", value: (r) => r.class },
  { key: "role", label: "Role", value: (r) => r.roleName ?? "" },
];

const TX_SEARCH_FIELDS = [(r) => r.holderName, (r) => r.fingerprint, (r) => r.detail];
const TX_FILTER_DEFS = [
  { key: "kind", label: "Type", value: (r) => r.kind },
  { key: "class", label: "Class", value: (r) => classLabel(r.accountClass) },
];

function classLabel(value) {
  if (value === "OFFSHORE") return "Offshore";
  if (value === "TREASURY") return "Treasury";
  return "—";
}

function signed(amount) {
  return amount > 0 ? `+${amount} ¢` : `${amount} ¢`;
}

export default function TreasuryDesk({
  rate,
  vaultObols,
  claims,
  stagedValue,
  accounts,
  transactions,
  selectedId,
  readOnly,
}) {
  const router = useRouter();
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(String(rate));
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const table = useTableState({
    rows: accounts,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "balanceObols", dir: "desc" },
  });

  const txTable = useTableState({
    rows: transactions,
    searchFields: TX_SEARCH_FIELDS,
    filterDefs: TX_FILTER_DEFS,
    initialSort: { key: "at", dir: "desc" },
  });

  const selected = selectedId ? accounts.find((a) => a.id === selectedId) : null;

  function save() {
    startTransition(async () => {
      const result = await setSellTaxRate({ rate: Number(draft) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setSaved(true);
      refresh();
    });
  }

  const short = vaultObols < claims;

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-5">
        <dl className="depot-totals">
          <div className={short ? "text-danger" : undefined}>
            <dt>Treasury</dt>
            <dd className="mono">{vaultObols} ¢</dd>
          </div>
          <div>
            <dt>Claimed</dt>
            <dd className="mono">{claims} ¢</dd>
          </div>
          <div>
            <dt>Staged to sell</dt>
            <dd className="mono">{stagedValue} ¢</dd>
          </div>
          <div>
            <dt>Sell tax</dt>
            <dd className="mono">{rate}%</dd>
          </div>
        </dl>
        {short && (
          <p className="mt-3 text-sm text-danger">
            The treasury holds less than the accounts claim — withdrawals will be refused.
          </p>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">
          Sell tax{" "}
          <InfoIcon text="The sell tax applies on every item sold to the Depot. It deposits in the treasury." />
        </h2>
        <div className="mt-4 flex items-end gap-2">
          <label className="field">
            <span>Rate, percent</span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft}
              disabled={readOnly || pending}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <button type="button" className="btn" disabled={readOnly || pending} onClick={save}>
            Set it
          </button>
        </div>
        {readOnly && <p className="mt-2 text-sm text-muted">Read-only — you must be at the terminal to change it.</p>}
        {saved && !error && <p className="mt-3 text-sm text-muted">Tax set</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      {selected ? (
        <section className="panel p-5">
          <h2 className="panel-header">{selected.holderName}</h2>
          <dl className="depot-totals mt-4">
            <div>
              <dt>Fingerprint</dt>
              <dd className="mono">{selected.fingerprint}</dd>
            </div>
            <div>
              <dt>Class</dt>
              <dd>{classLabel(selected.class)}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd className="mono">{selected.balanceObols} ¢</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm">
            <Link href="/treasury">← All accounts</Link>
          </p>
        </section>
      ) : (
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
                  <tr key={row.id} className="cursor-pointer" onClick={() => router.push(`/treasury?account=${row.id}`)}>
                    <td>
                      <Link href={`/treasury?account=${row.id}`} onClick={(e) => e.stopPropagation()}>
                        {row.holderName}
                      </Link>
                    </td>
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
      )}

      <section className="panel p-5">
        <h2 className="panel-header">Transactions</h2>
        <div className="mt-4 flex flex-col gap-3">
          <FilterBar
            filterDefs={TX_FILTER_DEFS}
            filters={txTable.filters}
            setFilters={txTable.setFilters}
            options={txTable.options}
            query={txTable.query}
            setQuery={txTable.setQuery}
            searchLabel="Search transactions"
          />
          {txTable.total === 0 ? (
            <p className="text-sm text-muted">No transactions yet.</p>
          ) : (
            <TableScroll minWidth="44rem">
              <thead>
                <tr>
                  <SortHeader label="Turn" sortKey="turn" sort={txTable.sort} onSort={txTable.toggleSort} />
                  <SortHeader label="Holder" sortKey="holderName" sort={txTable.sort} onSort={txTable.toggleSort} />
                  <SortHeader label="Fingerprint" sortKey="fingerprint" sort={txTable.sort} onSort={txTable.toggleSort} />
                  <SortHeader label="Type" sortKey="kind" sort={txTable.sort} onSort={txTable.toggleSort} />
                  <th>Detail</th>
                  <SortHeader label="Amount" sortKey="amount" sort={txTable.sort} onSort={txTable.toggleSort} />
                </tr>
              </thead>
              <tbody>
                {txTable.pageRows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono text-muted">{row.turn ?? "—"}</td>
                    <td>
                      {row.accountId && row.accountId !== selectedId ? (
                        <Link href={`/treasury?account=${row.accountId}`}>{row.holderName}</Link>
                      ) : (
                        row.holderName
                      )}
                    </td>
                    <td className="mono text-muted">{row.fingerprint || "—"}</td>
                    <td className="text-muted">{row.kind}</td>
                    <td className="text-muted">{row.detail || "—"}</td>
                    <td className={row.amount < 0 ? "mono text-danger" : "mono"}>{signed(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </TableScroll>
          )}
          <Pager
            page={txTable.page}
            totalPages={txTable.totalPages}
            total={txTable.total}
            unit="transactions"
            onPage={txTable.setPage}
          />
        </div>
      </section>
    </div>
  );
}
