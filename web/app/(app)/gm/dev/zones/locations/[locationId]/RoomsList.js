"use client";

import Link from "next/link";
import Panel from "@/app/components/Panel";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import useRetireDelete from "@/app/components/useRetireDelete";
import { createRoom, retireRoom, unretireRoom, hardDeleteRoom, roomDeleteBlockers } from "../../actions";

export default function RoomsList({ locationId, rows, canSuper }) {
  const { call, pending, error } = useActionRunner();

  const { onDelete, onRetire } = useRetireDelete({
    noun: "room",
    call,
    blockers: roomDeleteBlockers,
    hardDelete: hardDeleteRoom,
    retire: retireRoom,
    retireNote: "It drops out of every picker. Reversible.",
  });

  return (
    <Panel title="Rooms">
      <FormError>{error}</FormError>
      <table className="mono-table w-full">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Slug</th>
            <th scope="col">Kind</th>
            <th scope="col">Discord</th>
            <th scope="col">Status</th>
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.retiredAt ? "text-muted" : undefined}>
              <td>
                <Link href={`/gm/dev/zones/rooms/${r.id}`} className="menu-item">
                  {r.name}
                </Link>
              </td>
              <td className="mono">{r.slug}</td>
              <td>{r.kind}</td>
              <td>
                <span className="chip">{r.mirrored ? "mirrored" : "pending"}</span>
              </td>
              <td>{r.retiredAt ? <span className="chip">retired</span> : "live"}</td>
              <td className="whitespace-nowrap">
                {canSuper && (
                  <>
                    {r.retiredAt ? (
                      <button className="btn-quiet" disabled={pending} onClick={() => call(unretireRoom, r.id)}>
                        Unretire
                      </button>
                    ) : (
                      <button className="btn-quiet" disabled={pending} onClick={() => onRetire(r)}>
                        Retire
                      </button>
                    )}
                    <button className="btn-quiet" disabled={pending} onClick={() => onDelete(r)}>
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
          call(createRoom, locationId, {
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
          <input name="slug" required className="control" />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" required className="control" />
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select name="kind" defaultValue="PUBLIC">
            <option value="PUBLIC">PUBLIC</option>
            <option value="PRIVATE">PRIVATE</option>
          </select>
        </label>
        <label className="field flex-1">
          <span className="field-label">Description</span>
          <input name="description" className="control" />
        </label>
        <button type="submit" className="btn" disabled={pending}>
          New room
        </button>
      </form>
    </Panel>
  );
}
