"use client";

import Panel from "@/app/components/Panel";
import useActionRunner from "@/app/components/useActionRunner";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { updateZone } from "../actions";

const KINDS = ["SURFACE", "CAVE_GROUP", "CAVE_LEVEL"];

export default function ZoneForm({ zone }) {
  const { call, pending, error } = useActionRunner();
  const confirm = useConfirm();

  async function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get("name");
    if (name !== zone.name) {
      if (!(await confirm({
        title: "Rename this zone?",
        message: "This also renames its Discord category, #summary and role on the next mirror pass.",
        confirmLabel: "Rename",
      }))) return;
    }
    call(updateZone, zone.id, zone.updatedAt, {
      name,
      kind: form.get("kind"),
      sortOrder: form.get("sortOrder"),
      description: form.get("description"),
      mapPolygon: form.get("mapPolygon"),
      mapLabelX: form.get("mapLabelX"),
      mapLabelY: form.get("mapLabelY"),
    });
  }

  return (
    <Panel title="Zone">
      <FormError>{error}</FormError>
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <label className="field">
          <span className="field-label">Slug (permanent)</span>
          <input value={zone.slug} readOnly disabled className="control" />
        </label>
        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" defaultValue={zone.name} required className="control" />
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select name="kind" defaultValue={zone.kind}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Sort order</span>
          <input name="sortOrder" type="number" defaultValue={zone.sortOrder} className="control" />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea name="description" defaultValue={zone.description} className="control" />
        </label>
        <label className="field">
          <span className="field-label">Map polygon (JSON [[x,y],…], 0-100)</span>
          <textarea name="mapPolygon" defaultValue={zone.mapPolygon} className="control mono" />
        </label>
        <div className="flex gap-2">
          <label className="field">
            <span className="field-label">Map label X</span>
            <input name="mapLabelX" type="number" step="any" defaultValue={zone.mapLabelX ?? ""} className="control" />
          </label>
          <label className="field">
            <span className="field-label">Map label Y</span>
            <input name="mapLabelY" type="number" step="any" defaultValue={zone.mapLabelY ?? ""} className="control" />
          </label>
        </div>
        <button type="submit" className="btn" disabled={pending}>
          Save
        </button>
      </form>
    </Panel>
  );
}
