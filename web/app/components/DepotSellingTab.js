"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotDrop, depotSaleDestination } from "@/app/(app)/depot/actions";
import { TableScroll } from "./DataTable";
import Select from "./Select";
import RequestDialog from "./RequestDialog";

// What you have put in the drop box, and where the money is going.
//
// A staged row can still be re-pointed; a settled one is history and reads
// read-only. The dropdown at the top is not a stored setting — it seeds the
// next drop, and nothing else.
const DESTINATIONS = [
  { value: "SELF", label: "Self" },
  { value: "TREASURY", label: "Treasury" },
  { value: "MERCHANT", label: "Merchant" },
];

function destinationOptions(canSellToMerchant) {
  return DESTINATIONS.filter((d) => d.value !== "MERCHANT" || canSellToMerchant);
}

export default function DepotSellingTab({
  sales = [],
  allStagedSales = [],
  sellable = [],
  defaultDestination = "SELF",
  canSellToMerchant = false,
  licensed = false,
  sellTaxRate = 0,
  train,
  disabled,
}) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [destination, setDestination] = useState(defaultDestination);
  const [dropping, setDropping] = useState(null); // { tagId, name, unitPrice, max }
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState(null);

  const options = destinationOptions(canSellToMerchant);

  function drop(reason) {
    const n = Math.max(1, Math.min(Number(quantity) || 0, dropping.max));
    startTransition(async () => {
      const result = await depotDrop({ tagId: dropping.tagId, quantity: n, destination, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDropping(null);
      refresh();
    });
  }

  function repoint(saleId, value) {
    startTransition(async () => {
      const result = await depotSaleDestination({ saleId, destination: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
    });
  }

  const staged = sales.filter((s) => !s.settled);
  const settled = sales.filter((s) => s.settled);

  return (
    <div className="depot-split">
      <section className="panel p-5">
        <h2 className="panel-header">Selling</h2>

        <label className="field mt-4">
          <span>Default destination</span>
          <Select value={destination} onChange={(e) => setDestination(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>

        <p className="mt-3 text-sm text-muted">
          Whatever you drop is gone at once and pays out when the train leaves — it{" "}
          {train?.nextLabel ?? "runs every other turn"}.
          {sellTaxRate > 0 ? ` The Meister takes ${sellTaxRate}%.` : ""}
        </p>

        <h3 className="panel-header mt-6">Staged</h3>
        {staged.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing in the box.</p>
        ) : (
          <TableScroll minWidth="32rem">
            <thead>
              <tr>
                <th scope="col">Thing</th>
                <th scope="col">Worth</th>
                <th scope="col">Goes to</th>
              </tr>
            </thead>
            <tbody>
              {staged.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.tagName} <span className="mono text-muted">×{row.quantity}</span>
                  </td>
                  <td className="mono">{row.unitPrice * row.quantity} ¢</td>
                  <td>
                    <Select
                      value={row.destination}
                      disabled={disabled || pending}
                      onChange={(e) => repoint(row.id, e.target.value)}
                    >
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}

        <h3 className="panel-header mt-6">Sold</h3>
        {settled.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing yet.</p>
        ) : (
          <TableScroll minWidth="34rem">
            <thead>
              <tr>
                <th scope="col">Thing</th>
                <th scope="col">Gross</th>
                <th scope="col">Tax</th>
                <th scope="col">Net</th>
                <th scope="col">Went to</th>
              </tr>
            </thead>
            <tbody>
              {settled.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.tagName} <span className="mono text-muted">×{row.quantity}</span>
                  </td>
                  <td className="mono">{row.grossObols ?? 0} ¢</td>
                  <td className="mono text-muted">{row.taxObols ?? 0} ¢</td>
                  <td className="mono">{row.netObols ?? 0} ¢</td>
                  <td className="text-muted">{DESTINATIONS.find((d) => d.value === row.destination)?.label ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}

        {licensed && (
          <>
            <h3 className="panel-header mt-6">Everybody&apos;s staged selling</h3>
            {allStagedSales.length === 0 ? (
              <p className="mt-3 text-sm text-muted">The box is empty.</p>
            ) : (
              <TableScroll minWidth="34rem">
                <thead>
                  <tr>
                    <th scope="col">Who</th>
                    <th scope="col">Thing</th>
                    <th scope="col">Worth</th>
                    <th scope="col">Goes to</th>
                  </tr>
                </thead>
                <tbody>
                  {allStagedSales.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.holderName} <span className="mono text-muted">{row.fingerprint}</span>
                      </td>
                      <td>
                        {row.tagName} <span className="mono text-muted">×{row.quantity}</span>
                      </td>
                      <td className="mono">{row.unitPrice * row.quantity} ¢</td>
                      <td className="text-muted">
                        {DESTINATIONS.find((d) => d.value === row.destination)?.label ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableScroll>
            )}
          </>
        )}
      </section>

      <section className="panel p-5 depot-aside">
        <h2 className="panel-header">The drop box</h2>
        <p className="mt-2 text-sm text-muted">It sits on the counter, beside the ATM.</p>
        {sellable.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing on you the station buys.</p>
        ) : (
          <ul className="depot-list mt-3">
            {sellable.map((item) => (
              <li key={item.tagId}>
                <span>
                  {item.name} <span className="mono text-muted">×{item.quantity}</span>
                </span>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={disabled || pending}
                  onClick={() => {
                    setDropping({ ...item, max: item.quantity });
                    setQuantity(1);
                    setError(null);
                  }}
                >
                  {item.unitPrice} ¢ · Drop
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      {dropping && (
        <RequestDialog
          open
          title={`Drop ${dropping.name}`}
          submitLabel="Drop it"
          busy={pending}
          error={error}
          onCancel={() => setDropping(null)}
          onConfirm={drop}
        >
          <label className="field">
            <span>How many</span>
            <input
              type="number"
              min={1}
              max={dropping.max}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <p className="text-sm text-muted">
            {dropping.unitPrice} ¢ each, to the{" "}
            {DESTINATIONS.find((d) => d.value === destination)?.label ?? "Self"} account. It leaves your hands now.
          </p>
        </RequestDialog>
      )}
    </div>
  );
}
