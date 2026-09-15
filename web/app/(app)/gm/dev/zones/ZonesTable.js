"use client";

import Link from "next/link";
import Panel from "@/app/components/Panel";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import useRetireDelete from "@/app/components/useRetireDelete";
import ReorderButtons from "@/app/components/ReorderButtons";
import {
  createZone,
  retireZone,
  unretireZone,
  hardDeleteZone,
  zoneDeleteBlockers,
  reorderZone,
} from "./actions";

const KINDS = ["SURFACE", "CAVE_GROUP", "CAVE_LEVEL"];

// A modest table — a couple dozen zones at most — so no DataTable machinery,
// just the rows plus a create form and the retire/delete/reorder controls.
export default function ZonesTable({ rows, canSuper }) {
  const { call, pending, error } = useActionRunner();

  const { onDelete, onRetire } = useRetireDelete({
    noun: "zone",
    call,
    blockers: zoneDeleteBlockers,
    hardDelete: hardDeleteZone,
    retire: retireZone,
    deleteNote:
      "This removes the row for good. Its Discord footprint (if any) is torn down best-effort.",
  });

  return (
    <div className="flex flex-col gap-4">
      <FormError>{error}</FormError>

      <section className="panel overflow-x-auto p-3">
        <table className="mono-table w-full">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Slug</th>
              <th scope="col">Kind</th>
              <th scope="col">Locations</th>
              <th scope="col">Discord</th>
              <th scope="col">Status</th>
              <th scope="col" aria-label="Reorder" />
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((z, i) => (
              <tr key={z.id} className={z.retiredAt ? "text-muted" : undefined}>
                <td>
                  <Link href={`/gm/dev/zones/${z.id}`} className="menu-item">
                    {z.name}
                  </Link>
                </td>
                <td className="mono">{z.slug}</td>
                <td>{z.kind}</td>
                <td className="mono">{z.locationCount}</td>
                <td>
                  <span className="chip">{z.mirrored ? "mirrored" : "pending"}</span>
                </td>
                <td>{z.retiredAt ? <span className="chip">retired</span> : "live"}</td>
                <td className="whitespace-nowrap">
                  <ReorderButtons
                    label={z.name}
                    disabled={pending}
                    first={i === 0}
                    last={i === rows.length - 1}
                    onUp={() => call(reorderZone, z.id, "up")}
                    onDown={() => call(reorderZone, z.id, "down")}
                  />
                </td>
                <td className="whitespace-nowrap">
                  {canSuper && (
                    <>
                      {z.retiredAt ? (
                        <button className="btn-quiet" disabled={pending} onClick={() => call(unretireZone, z.id)}>
                          Unretire
                        </button>
                      ) : (
                        <button className="btn-quiet" disabled={pending} onClick={() => onRetire(z)}>
                          Retire
                        </button>
                      )}
                      <button className="btn-quiet" disabled={pending} onClick={() => onDelete(z)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <CreateZoneForm pending={pending} onCreate={(input) => call(createZone, input)} />
    </div>
  );
}

function CreateZoneForm({ pending, onCreate }) {
  return (
    <Panel title="New zone">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          onCreate({
            slug: form.get("slug"),
            name: form.get("name"),
            kind: form.get("kind"),
            sortOrder: form.get("sortOrder"),
            description: form.get("description"),
          });
          e.currentTarget.reset();
        }}
      >
        <label className="field">
          <span className="field-label">Slug (permanent)</span>
          <input name="slug" required className="control" placeholder="town" />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" required className="control" placeholder="Town" />
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select name="kind" defaultValue="SURFACE">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Sort order</span>
          <input name="sortOrder" type="number" defaultValue={0} className="control" />
        </label>
        <label className="field flex-1">
          <span className="field-label">Description</span>
          <input name="description" className="control" />
        </label>
        <button type="submit" className="btn" disabled={pending}>
          Create
        </button>
      </form>
    </Panel>
  );
}
