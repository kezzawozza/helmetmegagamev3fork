"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  createLocation,
  retireLocation,
  unretireLocation,
  hardDeleteLocation,
  locationDeleteBlockers,
  reorderLocation,
} from "../actions";

export default function LocationsList({ zoneId, rows, canSuper }) {
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

  async function onDelete(loc) {
    const blockers = await locationDeleteBlockers(loc.id);
    if (blockers.length) {
      await confirm({ title: "Can't delete this location", message: blockers.join("\n"), confirmLabel: "OK", cancelLabel: "" });
      return;
    }
    if (!(await confirm({ title: `Delete "${loc.name}"?`, message: "This removes the row for good.", confirmLabel: "Delete" }))) return;
    run(hardDeleteLocation, loc.id);
  }

  async function onRetire(loc) {
    if (!(await confirm({ title: `Retire "${loc.name}"?`, message: "Drops out of pickers, travel and the map. Reversible.", confirmLabel: "Retire" }))) return;
    run(retireLocation, loc.id);
  }

  return (
    <section className="panel flex flex-col gap-3 p-3">
      <h2 className="panel-header">Locations</h2>
      <FormError>{error}</FormError>
      <table className="mono-table w-full">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Slug</th>
            <th scope="col">Rooms</th>
            <th scope="col">Discord</th>
            <th scope="col">Status</th>
            <th scope="col" aria-label="Reorder" />
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={l.id} className={l.retiredAt ? "text-muted" : undefined}>
              <td>
                <Link href={`/gm/dev/zones/locations/${l.id}`} className="menu-item">
                  {l.name}
                </Link>
              </td>
              <td className="mono">{l.slug}</td>
              <td className="mono">{l.roomCount}</td>
              <td>
                <span className="chip">{l.mirrored ? "mirrored" : "pending"}</span>
              </td>
              <td>{l.retiredAt ? <span className="chip">retired</span> : "live"}</td>
              <td className="whitespace-nowrap">
                <button className="btn-quiet" disabled={pending || i === 0} onClick={() => run(reorderLocation, zoneId, l.id, "up")}>
                  ▲
                </button>
                <button className="btn-quiet" disabled={pending || i === rows.length - 1} onClick={() => run(reorderLocation, zoneId, l.id, "down")}>
                  ▼
                </button>
              </td>
              <td className="whitespace-nowrap">
                {canSuper && (
                  <>
                    {l.retiredAt ? (
                      <button className="btn-quiet" disabled={pending} onClick={() => run(unretireLocation, l.id)}>
                        Unretire
                      </button>
                    ) : (
                      <button className="btn-quiet" disabled={pending} onClick={() => onRetire(l)}>
                        Retire
                      </button>
                    )}
                    <button className="btn-quiet" disabled={pending} onClick={() => onDelete(l)}>
                      Delete
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          run(createLocation, zoneId, {
            slug: form.get("slug"),
            name: form.get("name"),
            indoors: form.get("indoors") === "on",
            sortOrder: form.get("sortOrder"),
            description: form.get("description"),
          });
          e.currentTarget.reset();
        }}
      >
        <label className="field">
          <span className="field-label">Slug (permanent)</span>
          <input name="slug" required className="control" />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" required className="control" />
        </label>
        <label className="field">
          <span className="field-label">Sort order</span>
          <input name="sortOrder" type="number" defaultValue={0} className="control" />
        </label>
        <label className="check-row">
          <input type="checkbox" name="indoors" />
          <span>Indoors</span>
        </label>
        <label className="field flex-1">
          <span className="field-label">Description</span>
          <input name="description" className="control" />
        </label>
        <button type="submit" className="btn" disabled={pending}>
          New location
        </button>
      </form>
    </section>
  );
}
