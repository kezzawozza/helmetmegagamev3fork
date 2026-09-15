"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const confirm = useConfirm();

  function run(action, ...args) {
    setError(null);
    startTransition(async () => {
      const res = await action(...args);
      if (res && res.ok === false) setError(res.error);
    });
  }

  async function onDelete(zone) {
    const blockers = await zoneDeleteBlockers(zone.id);
    if (blockers.length) {
      await confirm({
        title: "Can't delete this zone",
        message: blockers.join("\n"),
        confirmLabel: "OK",
        cancelLabel: "",
      });
      return;
    }
    if (!(await confirm({
      title: `Delete "${zone.name}"?`,
      message: "This removes the row for good. Its Discord footprint (if any) is torn down best-effort.",
      confirmLabel: "Delete",
    }))) return;
    run(hardDeleteZone, zone.id);
  }

  async function onRetire(zone) {
    if (!(await confirm({
      title: `Retire "${zone.name}"?`,
      message: "It drops out of every picker, travel and the map. Reversible.",
      confirmLabel: "Retire",
    }))) return;
    run(retireZone, zone.id);
  }

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
                  <button className="btn-quiet" disabled={pending || i === 0} onClick={() => run(reorderZone, z.id, "up")}>
                    ▲
                  </button>
                  <button className="btn-quiet" disabled={pending || i === rows.length - 1} onClick={() => run(reorderZone, z.id, "down")}>
                    ▼
                  </button>
                </td>
                <td className="whitespace-nowrap">
                  {canSuper && (
                    <>
                      {z.retiredAt ? (
                        <button className="btn-quiet" disabled={pending} onClick={() => run(unretireZone, z.id)}>
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

      <CreateZoneForm pending={pending} onCreate={(input) => run(createZone, input)} />
    </div>
  );
}

function CreateZoneForm({ pending, onCreate }) {
  return (
    <section className="panel flex flex-col gap-3 p-3">
      <h2 className="panel-header">New zone</h2>
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
    </section>
  );
}
