"use client";

import { useState } from "react";
import StackPicker, { pickedLines } from "../StackRow";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { taxRequest } from "@/app/(app)/character/requestActions";

// Tax (docs/tags.yaml's `taxman` description). One StackPicker over the
// faction members standing in your own zone — held is their ⬢, the count IS
// the amount you take, same as every other stack this component draws
// (web/app/components/StackRow.js). Everyone else in the faction is visible
// but not actionable, drawn as a plain list rather than disabled rows in the
// picker — a locked-out or out-of-zone member has no stack to dial, so there
// is nothing for a stepper to do there.
//
// Bascinet's subtitle, verbatim.
const TAX_SUBTITLE =
  "Select who you want to tax. They are told they are being taxed and can refuse. The resources land at the end of the turn, unless the player is Catatonic.";

function reasonFor(member) {
  if (member.catatonic) return "catatonic";
  if (member.lockedOut) return "just refused";
  if (!member.sameZone) return "elsewhere";
  return null;
}

export default function TaxDialog({ mode, onDone, onClose }) {
  const { roster, loading } = useRoster(["tax"]);
  const tax = roster?.tax ?? { canTax: false, members: [], rooms: [] };
  const [picks, setPicks] = useState({});
  const { submit, busy, error } = useSubmit();

  const actionable = tax.members.filter((m) => m.sameZone && !m.lockedOut);
  const rest = tax.members.filter((m) => !m.sameZone || m.lockedOut);

  const rows = actionable.map((m) => ({
    id: m.id,
    name: m.name,
    held: m.resources,
    max: m.resources,
    note: [m.roleTitle, m.catatonic ? "catatonic" : null].filter(Boolean).join(" · ") || null,
  }));

  const lines = pickedLines(picks).filter((l) => rows.some((r) => r.id === l.tagId));

  function onSubmit() {
    const submitPicks = Object.fromEntries(lines.map((l) => [l.tagId, String(l.quantity)]));
    submit(
      () => taxRequest({ picks: submitPicks }),
      (res) => onDone(noticeLine(mode, res)),
    );
  }

  const nothingToTax = !loading && tax.canTax && tax.members.length === 0;

  return (
    <ActionDialog
      title="Tax"
      busy={busy}
      error={error}
      loading={loading}
      empty={
        !loading && !tax.canTax
          ? "You can't tax right now."
          : nothingToTax
            ? "Nobody in your faction to tax."
            : null
      }
      canSubmit={lines.length > 0}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <p className="text-sm text-muted">{TAX_SUBTITLE}</p>

      <div className="panel flex flex-col gap-3 p-3">
        <span className="field-label">Resources</span>
        <StackPicker
          rows={rows}
          picks={picks}
          onChange={setPicks}
          emptyLabel="Nobody in your zone to tax."
        />
      </div>

      {tax.filed?.length > 0 && (
        <div className="panel flex flex-col gap-2 p-3">
          <span className="field-label">This turn</span>
          {tax.filed.map((f) => (
            <p key={f.id} className="text-sm text-muted flex justify-between gap-2">
              <span>{f.name}</span>
              <span className="mono">
                {f.amount} ⬢ ·{" "}
                {f.status === "refused" ? "Refused" : f.status === "partial" ? `Partial (${f.paidAmount} ⬢)` : "Pending"}
              </span>
            </p>
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div className="panel flex flex-col gap-2 p-3">
          <span className="field-label">Elsewhere in the faction</span>
          {rest.map((m) => (
            <p key={m.id} className="text-sm text-muted flex justify-between gap-2">
              <span>{m.name}</span>
              <span className="mono">
                {m.resources} ⬢{reasonFor(m) ? ` · ${reasonFor(m)}` : ""}
              </span>
            </p>
          ))}
        </div>
      )}

      {tax.rooms.length > 0 && (
        <div className="panel flex flex-col gap-2 p-3">
          <span className="field-label">Rooms in this zone</span>
          {tax.rooms.map((r) => (
            <p key={r.id} className="text-sm text-muted flex justify-between gap-2">
              <span>
                {r.locationName} · {r.name}
              </span>
              <span className="mono">{r.resources} ⬢</span>
            </p>
          ))}
        </div>
      )}
    </ActionDialog>
  );
}
