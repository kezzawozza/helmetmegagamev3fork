"use client";

import FormError from "@/app/components/FormError";
import Panel from "@/app/components/Panel";
import useActionRunner from "@/app/components/useActionRunner";
import { updateLocationMining } from "../../actions";

// `current` is the live, drifting coefficient re-computed every turn close —
// read-only here on purpose. `base` is what it drifts toward, and the only
// thing a GM edits.
//
// There were four rows here, one per Laboring kind. Mining is the only kind of
// day left, so a Location has one coefficient or none at all.
export default function YieldPanel({ locationId, row }) {
  const { call, pending, error } = useActionRunner();

  return (
    <Panel title="Mining yield">
      <FormError>{error}</FormError>
      <table className="mono-table w-full">
        <thead>
          <tr>
            <th scope="col" colSpan={2}>Base</th>
            <th scope="col">Current (read-only)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={2}>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  call(updateLocationMining, locationId, new FormData(e.currentTarget).get("base"));
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
        </tbody>
      </table>
      <p className="text-muted text-sm">
        No row at all means this place can&apos;t be mined — the Mine button never appears, and Examine
        leaves the line off entirely. A row drifted to 0 still shows both.
      </p>
    </Panel>
  );
}
