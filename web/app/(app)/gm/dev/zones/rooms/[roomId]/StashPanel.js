"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { seedRoomStash } from "../../actions";

// The stash: what's stamped in room/RoomTag rows already, plus the seed
// form. There is deliberately no "adjust quantity" writer here — a stash
// quantity is play state (players carry it off), and the one thing this
// panel is allowed to do to it is add MORE, once, from a fresh authoring
// list. Everyday quantity moves stay in Transfer/Storage on the player side.
export default function StashPanel({ roomId, resources, stash, seededStashSlugs, canSuper }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  function onSeed(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const text = new FormData(e.currentTarget).get("lines");
    startTransition(async () => {
      const res = await seedRoomStash(roomId, text);
      if (res && res.ok === false) setError(res.error);
      else setResult(`Seeded ${res.seeded} slug${res.seeded === 1 ? "" : "s"}.`);
    });
  }

  return (
    <section className="panel flex flex-col gap-3 p-3">
      <h2 className="panel-header">Stash</h2>
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
    </section>
  );
}
