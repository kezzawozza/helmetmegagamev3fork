"use client";

import { useState } from "react";
import PartySelect from "../PartySelect";
import StackPicker, { pickedLines } from "../StackRow";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { pickpocketRequest, pickpocketTakeRequest } from "@/app/(app)/character/requestActions";

// Pickpocket (docs/systemdocs/THEFT.md §2). Two panes, because it is two acts:
// the hand goes in, and then you choose. Pressing the first button is the
// commitment — it spends the one attempt you get at this person this turn,
// whatever you do next.
//
// PartySelect rather than a ChipPicker, the SearchDialog reasoning: this is one
// of the handful of verbs that reaches somebody in a hood, so a concealed row
// carries `kind: "hood"` and posts "hood:<token>" instead of an id
// (PROXYING.md §5). The pool is `searchParties` itself rather than a second
// identical list — Search asks exactly the same question about who is reachable.
//
// The rows in pane two are a plain name and a weight and NO TagChip, unlike
// every other stack list in the app. That is the helpless-pockets rule
// (REQUESTS.md §5b): the filter behind them is `tradeable`, not
// `catalogVisibility`, so a secret tag is already named here, and putting its
// description, recipe and cost on a hover would be a second leak on top of the
// one the verb is for.
export default function PickpocketDialog({ presets, onDone, onClose }) {
  const pools = useActionPools();
  const { roster, loading } = useRoster(["people"], {
    seed: { people: { searchParties: pools.searchParties ?? [] } },
  });
  const [targetKey, setTargetKey] = useState(presets?.targetId ?? "");
  // Pane two's whole state: what came back from the roll. Null until the hand
  // is in. `failed` is its own flag rather than an empty `open`, so a roll that
  // turned up nothing to steal does not read as a failure.
  const [open, setOpen] = useState(null);
  const [failed, setFailed] = useState(false);
  const [picks, setPicks] = useState({});
  const { submit, busy, error } = useSubmit();

  const targets = roster?.people?.searchParties ?? [];
  const chosen = targets.find((t) => `${t.kind ?? "character"}:${t.id}` === targetKey) ?? null;
  const theirName = open?.targetName ?? chosen?.name ?? "them";

  const rows = (open?.rows ?? []).map((r) => ({
    id: r.tagId,
    name: r.name,
    held: r.quantity,
    max: r.quantity,
    note: r.each > 0 ? `${r.each} lb` : null,
  }));
  const lines = pickedLines(picks);
  // `?? 0` matters: a pick whose row has gone (a stale panel) would otherwise
  // make this NaN, and NaN > left is false — so the budget line would read
  // "NaN lb" and Take would stay enabled.
  const lbs =
    Math.round(
      lines.reduce((n, l) => n + ((open?.rows ?? []).find((r) => r.tagId === l.tagId)?.each ?? 0) * l.quantity, 0) *
        100,
    ) / 100;
  const budget = open?.budgetLbs ?? 0;
  const left = Math.round((budget - (open?.spentLbs ?? 0)) * 100) / 100;
  const overBudget = lbs > left;

  function reachIn() {
    if (!targetKey) return;
    submit(
      () => pickpocketRequest({ targetKey }),
      (res) => {
        if (res.outcome === "failed") {
          setFailed(true);
          return;
        }
        setOpen(res);
      },
    );
  }

  function take() {
    if (!lines.length || overBudget) return;
    const tags = lines.map((l) => ({ tagId: l.tagId, quantity: String(l.quantity) }));
    submit(
      () => pickpocketTakeRequest({ targetKey, tags }),
      // Outcome-blind on purpose. The server tells the thief nothing about the
      // die, so this sentence cannot vary with it — whether they felt your hand
      // is theirs to know and not yours.
      () => onDone(`Took what you could off ${theirName}.`),
    );
  }

  if (failed) {
    return (
      <ActionDialog
        title="Pickpocket"
        submitLabel="Close"
        busy={busy}
        error={error}
        canSubmit
        onClose={onClose}
        onSubmit={onClose}
      >
        <p className="text-sm">Your hand came out empty, and they felt it go in.</p>
      </ActionDialog>
    );
  }

  if (open) {
    return (
      <ActionDialog
        title="Pickpocket"
        submitLabel="Take it"
        width="wide"
        busy={busy}
        error={error}
        empty={rows.length === 0 ? `${theirName} is carrying nothing you could lift.` : null}
        canSubmit={Boolean(lines.length) && !overBudget}
        onClose={onClose}
        onSubmit={take}
      >
        <div className="panel flex flex-col gap-3 p-3">
          <span className="field-label">Take</span>
          <StackPicker
            rows={rows}
            picks={picks}
            onChange={setPicks}
            emptyLabel={`${theirName} is carrying nothing you could lift.`}
          />
        </div>
        <p className={`text-xs ${overBudget ? "text-accent" : "text-muted"}`}>
          {lbs} / {left} lb
          {overBudget ? " — more than you could get away with unnoticed." : ""}
        </p>
      </ActionDialog>
    );
  }

  return (
    <ActionDialog
      title="Pickpocket"
      submitLabel="Reach in"
      busy={busy}
      error={error}
      loading={loading && targets.length === 0}
      empty={!loading && targets.length === 0 ? "There's nobody here to pickpocket." : null}
      canSubmit={Boolean(targetKey)}
      onClose={onClose}
      onSubmit={reachIn}
    >
      <PartySelect
        label="Whose pocket?"
        hint="Pick somebody"
        characters={targets}
        value={targetKey}
        onChange={setTargetKey}
      />
      <p className="text-xs text-muted">
        One try each per turn, whether it works or not. Pressing this spends it.
      </p>
    </ActionDialog>
  );
}
