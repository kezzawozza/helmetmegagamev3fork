"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { updateLocation } from "../../actions";

export default function LocationForm({ location, attributeSchema = [] }) {
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
    const attributes = {};
    for (const attr of attributeSchema) {
      attributes[attr.key] = attr.type === "boolean" ? form.get(`attr_${attr.key}`) === "on" : form.get(`attr_${attr.key}`);
    }
    startTransition(async () => {
      const res = await updateLocation(location.id, location.updatedAt, {
        name,
        indoors: form.get("indoors") === "on",
        sortOrder: form.get("sortOrder"),
        description: form.get("description"),
        attributes,
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

        {attributeSchema.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="field-label">Attributes</legend>
            {attributeSchema.map((attr) => (
              <AttributeField key={attr.key} attr={attr} value={location.attributes?.[attr.key]} />
            ))}
          </fieldset>
        )}

        <button type="submit" className="btn" disabled={pending}>
          Save
        </button>
      </form>
    </section>
  );
}

// One control per registry entry, per its `type` — boolean a checkbox,
// number a number input, enum a <select> over its `options`, anything else
// (plain "string") free text. The registry drives this, not a hand-kept
// list, so a new attribute only needs a `type` there to get a control here.
function AttributeField({ attr, value }) {
  const name = `attr_${attr.key}`;
  if (attr.type === "boolean") {
    return (
      <label className="check-row">
        <input type="checkbox" name={name} defaultChecked={Boolean(value)} />
        <span>{attr.key}</span>
      </label>
    );
  }
  if (attr.type === "number") {
    return (
      <label className="field">
        <span className="field-label">{attr.key}</span>
        <input name={name} type="number" step="any" defaultValue={value ?? ""} className="control" />
      </label>
    );
  }
  if (attr.type === "enum") {
    return (
      <label className="field">
        <span className="field-label">{attr.key}</span>
        <select name={name} defaultValue={value ?? ""}>
          <option value="">— none —</option>
          {(attr.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="field">
      <span className="field-label">{attr.key}</span>
      <input name={name} defaultValue={value ?? ""} className="control" />
    </label>
  );
}
