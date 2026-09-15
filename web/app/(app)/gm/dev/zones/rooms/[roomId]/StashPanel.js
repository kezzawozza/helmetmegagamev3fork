"use client";

import { useState } from "react";
import Panel from "@/app/components/Panel";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { seedRoomStash } from "../../actions";

// The stash: what's stamped in room/RoomTag rows already, plus the seed
// form. There is deliberately no "adjust quantity" writer here — a stash
// quantity is play state (players carry it off), and the one thing this
// panel is allowed to do to it is add MORE, once, from a fresh authoring
// list. Everyday quantity moves stay in Transfer/Storage on the player side.
export default function StashPanel({ roomId, resources, stash, seededStashSlugs, canSuper }) {
  const { run, pending, error } = useActionRunner();
  const [result, setResult] = useState(null);

  function onSeed(e) {
    e.preventDefault();
    setResult(null);
    const text = new FormData(e.currentTarget).get("lines");
    // An arrow rather than `call`, because this is the one here that wants
    // onOk — seedRoomStash reports how many slugs it actually took.
    run(() => seedRoomStash(roomId, text), undefined, {
      onOk: (res) => setResult(`Seeded ${res.seeded} slug${res.seeded === 1 ? "" : "s"}.`),
    });
  }

  return (
    <Panel title="Stash">
      <p>
        <span className="chip">{resources} ⬢</span>
      </p>
      <table className="mono-table w-full">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Slug</th>
            <th scope="col">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {stash.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="mono">{s.slug}</td>
              <td className="mono">{s.quantity}</td>
            </tr>
          ))}
          {stash.length === 0 && (
            <tr>
              <td colSpan={3} className="text-muted">
                Nothing stashed here.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canSuper && (
        <>
          <FormError>{error}</FormError>
          {result && <p className="text-sm">{result}</p>}
          <form className="flex flex-col gap-2" onSubmit={onSeed}>
            <label className="field">
              <span className="field-label">Seed these items now — one &ldquo;slug: count&rdquo; per line</span>
              <textarea name="lines" className="control mono" rows={4} placeholder={"longbow: 1\ntorch: 3"} />
            </label>
            <p className="text-muted text-sm">
              A slug already in this room&rsquo;s seed history ({seededStashSlugs.length ? seededStashSlugs.join(", ") : "none yet"}) is
              skipped — an emptied stash never refills itself.
            </p>
            <button type="submit" className="btn" disabled={pending}>
              Seed
            </button>
          </form>
        </>
      )}
    </Panel>
  );
}
