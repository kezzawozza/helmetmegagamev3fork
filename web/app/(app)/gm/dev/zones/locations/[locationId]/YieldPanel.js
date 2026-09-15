"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { updateLocationYield } from "../../actions";

const KINDS = ["HUNTING", "FARMING", "FISHING", "PROSPECTING"];

// `current` is the live, drifting coefficient re-computed every turn close —
// read-only here on purpose. `base` is what it drifts toward, and the only
// thing a GM edits.
export default function YieldPanel({ locationId, rows }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));

  function save(kind, base) {
    setError(null);
    startTransition(async () => {
      const res = await updateLocationYield(locationId, kind, base);
      if (res && res.ok === false) setError(res.error);
    });
  }

  return (
    <section className="panel flex flex-col gap-3 p-3">
      <h2 className="panel-header">Labor yield</h2>
      <FormError>{error}</FormError>
      <table className="mono-table w-full">
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col" colSpan={2}>Base</th>
            <th scope="col">Current (read-only)</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map((kind) => {
            const row = byKind[kind];
            return (
              <tr key={kind}>
                <td>{kind}</td>
                <td colSpan={2}>
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save(kind, new FormData(e.currentTarget).get("base"));
                    }}
                  >
                    <input name="base" type="number" step="any" defaultValue={row?.base ?? ""} className="control" />
                    <button type="submit" className="btn-quiet" disabled={pending}>
                      Save
                    </button>
                  </form>
                </td>
                <td className="mono">{row ? row.current.toFixed(3) : "— (no row)"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-muted text-sm">A kind with no row at all is impossible here — the Labor? button prints a bare &ldquo;x&rdquo;.</p>
    </section>
  );
}
