"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { updateLocation } from "../../actions";

export default function LocationForm({ location }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const confirm = useConfirm();

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = form.get("name");
    if (name !== location.name) {
      if (!(await confirm({
        title: "Rename this location?",
        message: "This also renames its Discord channel on the next mirror pass.",
        confirmLabel: "Rename",
      }))) return;
    }
    startTransition(async () => {
      const res = await updateLocation(location.id, location.updatedAt, {
        name,
        indoors: form.get("indoors") === "on",
        sortOrder: form.get("sortOrder"),
        description: form.get("description"),
      });
      if (res && res.ok === false) setError(res.error);
    });
  }

  return (
    <section className="panel flex flex-col gap-3 p-3">
      <h2 className="panel-header">Location</h2>
      <FormError>{error}</FormError>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <label className="field">
          <span className="field-label">Slug (permanent)</span>
          <input value={location.slug} readOnly disabled className="control" />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" defaultValue={location.name} required className="control" />
        </label>
        <label className="check-row">
          <input type="checkbox" name="indoors" defaultChecked={location.indoors} />
          <span>Indoors</span>
        </label>
        <label className="field">
          <span className="field-label">Sort order</span>
          <input name="sortOrder" type="number" defaultValue={location.sortOrder} className="control" />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea name="description" defaultValue={location.description} className="control" />
        </label>
        <button type="submit" className="btn" disabled={pending}>
          Save
        </button>
      </form>
    </section>
  );
}
