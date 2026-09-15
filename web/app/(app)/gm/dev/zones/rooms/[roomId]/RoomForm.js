"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { updateRoom } from "../../actions";

export default function RoomForm({ room }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const confirm = useConfirm();

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = form.get("name");
    if (name !== room.name) {
      if (!(await confirm({
        title: "Rename this room?",
        message: "This also renames its Discord thread on the next mirror pass.",
        confirmLabel: "Rename",
      }))) return;
    }
    startTransition(async () => {
      const res = await updateRoom(room.id, room.updatedAt, {
        name,
        kind: form.get("kind"),
        sortOrder: form.get("sortOrder"),
        description: form.get("description"),
        soundproof: form.get("soundproof") === "on",
        destroysContents: form.get("destroysContents") === "on",
        accessTagSlugs: form.get("accessTagSlugs"),
      });
      if (res && res.ok === false) setError(res.error);
    });
  }

  return (
    <section className="panel flex flex-col gap-3 p-3">
      <h2 className="panel-header">Room</h2>
      <FormError>{error}</FormError>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <label className="field">
          <span className="field-label">Slug (permanent)</span>
          <input value={room.slug} readOnly disabled className="control" />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" defaultValue={room.name} required className="control" />
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select name="kind" defaultValue={room.kind}>
            <option value="PUBLIC">PUBLIC</option>
            <option value="PRIVATE">PRIVATE</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Access tag slugs (PRIVATE only, comma-separated)</span>
          <input name="accessTagSlugs" defaultValue={room.accessTagSlugs} className="control" />
        </label>
        <label className="field">
          <span className="field-label">Sort order</span>
          <input name="sortOrder" type="number" defaultValue={room.sortOrder} className="control" />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea name="description" defaultValue={room.description} className="control" />
        </label>
        <label className="check-row">
          <input type="checkbox" name="soundproof" defaultChecked={room.soundproof} />
          <span>Soundproof</span>
        </label>
        <label className="check-row">
          <input type="checkbox" name="destroysContents" defaultChecked={room.destroysContents} />
          <span>Destroys contents (spillway)</span>
        </label>
        <button type="submit" className="btn" disabled={pending}>
          Save
        </button>
      </form>
    </section>
  );
}
