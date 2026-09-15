"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { createLink, updateLink, deleteLink } from "../actions";

const ANNOUNCE = ["NONE", "TRUE_NAME", "CONCEALED"];

export default function LinksTable({ rows, locationOptions, canSuper }) {
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

  async function onDelete(link) {
    if (!(await confirm({ title: "Delete this link?", message: `${link.aName} ↔ ${link.bName}`, confirmLabel: "Delete" }))) return;
    run(deleteLink, link.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError>{error}</FormError>
      <table className="mono-table w-full">
        <thead>
          <tr>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col">Announce</th>
            <th scope="col">Hidden</th>
            <th scope="col">Modular</th>
            <th scope="col">Open (live)</th>
            <th scope="col">Keyed</th>
            <th scope="col">On foot</th>
            <th scope="col">Required tag</th>
            <th scope="col" aria-label="Save" />
            <th scope="col" aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <LinkRow key={l.id} link={l} canSuper={canSuper} pending={pending} onSave={(input) => run(updateLink, l.id, l.updatedAt, input)} onDelete={() => onDelete(l)} />
          ))}
        </tbody>
      </table>

      <section className="panel flex flex-col gap-3 p-3">
        <h2 className="panel-header">New link</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            run(createLink, {
              aId: form.get("aId"),
              bId: form.get("bId"),
              announce: form.get("announce"),
              hidden: form.get("hidden") === "on",
              modular: form.get("modular") === "on",
              keyed: form.get("keyed") === "on",
              onFoot: form.get("onFoot") === "on",
              requiredTagSlug: form.get("requiredTagSlug"),
              authoredOpen: form.get("authoredOpen") === "on",
            });
          }}
        >
          <label className="field">
            <span className="field-label">A</span>
            <select name="aId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {locationOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">B</span>
            <select name="bId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {locationOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Announce</span>
            <select name="announce" defaultValue="NONE">
              {ANNOUNCE.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Required tag slug</span>
            <input name="requiredTagSlug" className="control" />
          </label>
          <label className="check-row">
            <input type="checkbox" name="hidden" />
            <span>Hidden</span>
          </label>
          <label className="check-row">
            <input type="checkbox" name="modular" />
            <span>Modular</span>
          </label>
          <label className="check-row">
            <input type="checkbox" name="authoredOpen" defaultChecked />
            <span>Born open (modular)</span>
          </label>
          <label className="check-row">
            <input type="checkbox" name="keyed" />
            <span>Keyed</span>
          </label>
          <label className="check-row">
            <input type="checkbox" name="onFoot" />
            <span>On foot</span>
          </label>
          <button type="submit" className="btn" disabled={pending}>
            Create
          </button>
        </form>
      </section>
    </div>
  );
}

function LinkRow({ link, canSuper, pending, onSave, onDelete }) {
  function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onSave({
      announce: form.get("announce"),
      hidden: form.get("hidden") === "on",
      modular: form.get("modular") === "on",
      keyed: form.get("keyed") === "on",
      onFoot: form.get("onFoot") === "on",
      requiredTagSlug: form.get("requiredTagSlug"),
      authoredOpen: form.get("authoredOpen") === "on",
    });
  }

  return (
    <tr>
      <td>
        <form id={`link-${link.id}`} onSubmit={submit} className="contents" />
        {link.aName}
      </td>
      <td>{link.bName}</td>
      <td>
        <select name="announce" defaultValue={link.announce} form={`link-${link.id}`}>
          {ANNOUNCE.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input type="checkbox" name="hidden" defaultChecked={link.hidden} form={`link-${link.id}`} />
      </td>
      <td>
        <input type="checkbox" name="modular" defaultChecked={link.modular} form={`link-${link.id}`} />
      </td>
      <td className="mono">{link.isOpen ? "open" : "shut"}</td>
      <td>
        <input type="checkbox" name="keyed" defaultChecked={link.keyed} form={`link-${link.id}`} />
      </td>
      <td>
        <input type="checkbox" name="onFoot" defaultChecked={link.onFoot} form={`link-${link.id}`} />
      </td>
      <td>
        <input name="requiredTagSlug" defaultValue={link.requiredTagSlug} className="control" form={`link-${link.id}`} />
        <input type="checkbox" name="authoredOpen" defaultChecked={link.authoredOpen} hidden form={`link-${link.id}`} />
      </td>
      <td>
        <button type="submit" form={`link-${link.id}`} className="btn-quiet" disabled={pending}>
          Save
        </button>
      </td>
      <td>{canSuper && <button className="btn-quiet" disabled={pending} onClick={onDelete}>Delete</button>}</td>
    </tr>
  );
}
