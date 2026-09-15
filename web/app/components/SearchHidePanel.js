"use client";

import { useEffect, useState } from "react";
import CheckField from "./CheckField";
import { loadSearchHideables, setSearchHidden } from "@/app/(app)/chat/dmActions";

// The responder's half of a Search (docs/systemdocs/SEARCH.md §2): what you are
// willing to try to keep out of somebody's hands. Opens in place of the Yes/No
// row and closes back to it, because hiding is not an answer — nothing is
// decided until Yes is pressed, and this can be reopened and changed until then.
//
// Only HIDDEN and WORN things are listed. Something `visible: true` is seen
// standing in the road, so offering to hide it would be a lie.
//
// Uncapped, unlike the Discord twin, which can only draw 25 rows in a select
// menu. This is the face that can always show the whole sheet.
export default function SearchHidePanel({ offerId, onClose }) {
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    loadSearchHideables(offerId)
      .then((res) => {
        if (!live) return;
        if (!res?.ok) {
          setProblem(res?.reason ?? "That offer's gone.");
          setRows([]);
          return;
        }
        setRows(res.rows);
        setPicked(new Set(res.hidden ?? []));
      })
      .catch(() => live && setProblem("That didn't load. Try again."));
    return () => {
      live = false;
    };
  }, [offerId]);

  function toggle(tagId) {
    // Rebuilt rather than mutated: react-hooks/immutability is an error here.
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
    setSaved(false);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await setSearchHidden(offerId, [...picked]);
      if (!res?.ok) {
        setProblem(res?.reason ?? "That didn't go through. Try again.");
        setBusy(false);
        return;
      }
      setSaved(true);
      setBusy(false);
    } catch {
      setProblem("That didn't go through. Try again.");
      setBusy(false);
    }
  }

  if (problem) return <p className="dm-action-outcome">{problem}</p>;
  if (rows === null) return <p className="dm-action-outcome">Reading your pockets…</p>;

  return (
    <div className="dm-action-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">You have nothing on you that could be hidden.</p>
      ) : (
        <>
          <span className="field-label">What do you want to hide?</span>
          {rows.map((row) => (
            <CheckField
              key={row.tagId}
              checked={picked.has(row.tagId)}
              onChange={() => toggle(row.tagId)}
            >
              {row.quantity > 1 ? `${row.name} ×${row.quantity}` : row.name}
            </CheckField>
          ))}
          {/* Nothing here is a tooltip. The floor is why hiding one thing is
              stronger than hiding five, and nobody can work that out from
              play — the die is never shown to anybody. */}
          <p className="text-xs text-muted">
            Hiding more does not hide it better. The fewer things you hide, the better the
            chance all of them stay hidden.
          </p>
        </>
      )}
      <div className="dm-action-row">
        {rows.length > 0 && (
          <button type="button" className="btn" disabled={busy} onClick={save}>
            {saved ? "Saved" : "Save"}
          </button>
        )}
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
}
