"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import StackPicker, { pickedLines } from "../StackRow";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { purchaseGear } from "@/app/(app)/character/thanatiActions";

// Purchase Gear (docs/systemdocs/THANATI.md §3): the cult's shelf as rows
// with a count, and which of the four purses pays first. Both purse controls
// are PREFERENCES, not restrictions — whatever you pick first pays until it
// runs out, then the rest covers it. No line of explanation, by ruling.
export default function PurchaseDialog({ mode, onDone, onClose }) {
  const pools = useActionPools();
  const wares = pools.thanatiWares ?? [];
  const stock = pools.hideoutStock ?? null;
  const [picks, setPicks] = useState({});
  const [currency, setCurrency] = useState("obols");
  const [purse, setPurse] = useState("room");
  const { submit, busy, error } = useSubmit();

  const rows = wares.map((w) => ({ id: w.tagId, name: w.name, held: 99, max: 99, note: `${w.price} each` }));
  const lines = pickedLines(picks);
  const total = lines.reduce((sum, l) => sum + (wares.find((w) => w.tagId === l.tagId)?.price ?? 0) * l.quantity, 0);
  const funds =
    (stock?.room?.resources ?? 0) + (stock?.room?.obols ?? 0) + (stock?.self?.resources ?? 0) + (stock?.self?.obols ?? 0);

  return (
    <ActionDialog
      title="Purchase gear"
      submitLabel="Buy"
      width="wide"
      busy={busy}
      error={error}
      empty={rows.length === 0 ? "The shelf is bare." : null}
      canSubmit={lines.length > 0 && total <= funds}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => purchaseGear({ items: lines.map((l) => ({ tagId: l.tagId, quantity: l.quantity })), currency, purse }),
          (res) => onDone(noticeLine(mode, res)),
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChipPicker
          label="Spend first"
          options={[
            { id: "obols", label: "Obols" },
            { id: "resources", label: "⬢" },
          ]}
          value={currency}
          onChange={(v) => v && setCurrency(v)}
        />
        <ChipPicker
          label="Take from"
          options={[
            { id: "room", label: "The floor" },
            { id: "self", label: "Your pockets" },
          ]}
          value={purse}
          onChange={(v) => v && setPurse(v)}
        />
      </div>
      <p className="text-xs text-muted">
        Floor: {stock?.room?.obols ?? 0} ¢ · {stock?.room?.resources ?? 0} ⬢. You: {stock?.self?.obols ?? 0} ¢ ·{" "}
        {stock?.self?.resources ?? 0} ⬢. Whatever you pick first pays until it runs out, then the rest covers it.
      </p>
      <StackPicker rows={rows} picks={picks} onChange={setPicks} />
      <div className="flex justify-end">
        <span className={`mono text-sm ${total > funds ? "text-danger" : ""}`}>
          {total} / {funds}
        </span>
      </div>
    </ActionDialog>
  );
}
