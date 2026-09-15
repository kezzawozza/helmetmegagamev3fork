"use client";

import Link from "next/link";
import Panel from "@/app/components/Panel";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import useRetireDelete from "@/app/components/useRetireDelete";
import ReorderButtons from "@/app/components/ReorderButtons";
import {
  createLocation,
  retireLocation,
  unretireLocation,
  hardDeleteLocation,
  locationDeleteBlockers,
  reorderLocation,
} from "../actions";

export default function LocationsList({ zoneId, rows, canSuper }) {
  const { call, pending, error } = useActionRunner();

  const { onDelete, onRetire } = useRetireDelete({
    noun: "location",
    call,
    blockers: locationDeleteBlockers,
    hardDelete: hardDeleteLocation,
    retire: retireLocation,
  });

  return (
    <Panel title="Locations">
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
                <ReorderButtons
                  label={l.name}
                  disabled={pending}
                  first={i === 0}
                  last={i === rows.length - 1}
                  onUp={() => call(reorderLocation, zoneId, l.id, "up")}
                  onDown={() => call(reorderLocation, zoneId, l.id, "down")}
                />
              </td>
              <td className="whitespace-nowrap">
                {canSuper && (
                  <>
                    {l.retiredAt ? (
                      <button className="btn-quiet" disabled={pending} onClick={() => call(unretireLocation, l.id)}>
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
          call(createLocation, zoneId, {
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
    </Panel>
  );
}
