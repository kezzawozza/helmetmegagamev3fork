"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { useConfirm } from "./ConfirmProvider";
import { depotGenerator, depotRefuel, depotTurret } from "@/app/(app)/depot/actions";
import RequestDialog from "./RequestDialog";
import Tooltip from "./Tooltip";

// The hardware: the generator, the fuel it eats, and the gun in the ceiling.
//
// The turret's confirm spells out the trap rather than asking a polite "are you
// sure?" — the failure mode is somebody arming it while concealed and being shot
// by their own gun, and a vague confirm would not have stopped that.
//
// The generator is split by direction. A Docker with a keycard can feed it and
// fire it up, because a dead generator otherwise means a dead Depot until the
// Merchant next logs in — a whole real day on 24-hour turns. Only the licence
// can shut it down, because the lights going out take the turret with them.
export default function DepotStationTab({ depot, fuel, disabled, poweredDisabled, handPoweredDisabled }) {
  const [refresh] = useRefresh();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState(null);

  function submitRefuel(reason) {
    const n = Math.max(1, Math.min(Number(quantity) || 0, dialog.held));
    startTransition(async () => {
      const result = await depotRefuel({ slug: dialog.slug, quantity: n, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog(null);
      refresh();
    });
  }

  function submitPower(reason) {
    startTransition(async () => {
      const result = await depotGenerator({ on: !depot.generatorOn, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog(null);
      refresh();
    });
  }

  // One dialog, the way the Gatehouse turret does it: the confirm IS the
  // confirm, and saying yes throws the switch.
  async function askTurret() {
    const arming = !depot.turretArmed;
    const ok = await confirm({
      title: arming ? "Arm the turret?" : "Disarm the turret?",
      message: arming
        ? `It will fire on everyone standing in the depot except the face it has on file${
            depot.merchantFace ? ` — ${depot.merchantFace}` : ", and no face is on file, so it will fire on everyone"
          }. Concealing yourself makes you a target, and a keycard will not save a Docker. People will be shot on the way in and again at the end of every turn.`
        : "It goes quiet and the depot is open to anyone who walks in.",
      confirmLabel: arming ? "Arm" : "Disarm",
      cancelLabel: "Leave it",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await depotTurret({ armed: arming });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
    });
  }

  return (
    <div className="depot-split">
      <section className="panel p-5">
        <h2 className="panel-header">Generator</h2>
        <p className="mt-1 text-sm text-muted">
          It burns {depot.fuelBurnPerTurn} units a turn while it runs. With it out, nothing at the
          Depot works.
        </p>

        <dl className="depot-totals">
          <div>
            <dt>In the tank</dt>
            <dd className="mono">
              {depot.generatorFuel} / {depot.fuelMax}
            </dd>
          </div>
          <div>
            <dt>Turns of running left</dt>
            <dd className="mono">{fuel.turnsLeft ?? "—"}</dd>
          </div>
        </dl>

        <button
          type="button"
          className={depot.generatorOn ? "btn-quiet mt-4" : "btn mt-4"}
          // Starting is a hand's job, stopping is the licence-holder's, and
          // neither may be gated on the power it is there to restore.
          disabled={
            (depot.generatorOn ? poweredDisabled : handPoweredDisabled) ||
            pending ||
            (!depot.generatorOn && depot.generatorFuel <= 0)
          }
          onClick={() => setDialog({ kind: "power" })}
        >
          {depot.generatorOn ? "Shut it down" : "Fire it up"}
        </button>

        <h3 className="group-label depot-subhead">Feed it</h3>
        <ul className="depot-list">
          {fuel.sources.map((source) => (
            <li key={source.slug}>
              <span>
                {source.name}
                <span className="text-muted"> · {source.perUnit} units each</span>
              </span>
              <span className="depot-crate-line">
                <span className="mono text-muted">×{source.held}</span>
                <Tooltip
                  text={
                    source.held
                      ? `Shovels ${source.name} in. Overfilling wastes the surplus — the tank only holds ${depot.fuelMax}.`
                      : `You are not carrying any ${source.name}.`
                  }
                >
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={handPoweredDisabled || pending || !source.held}
                    onClick={() => {
                      setDialog({ kind: "refuel", ...source });
                      setQuantity(1);
                    }}
                  >
                    Feed
                  </button>
                </Tooltip>
              </span>
            </li>
          ))}
        </ul>
        {error && !dialog && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">Turret</h2>
        <p className="mt-1 text-sm text-muted">It shoots everyone except the merchant.</p>

        <dl className="depot-totals">
          <div>
            <dt>Face on file</dt>
            <dd className="mono">{depot.merchantFace || "— nobody —"}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd className={depot.turretArmed ? "text-danger" : "text-muted"}>
              {depot.turretArmed ? "Armed" : "Safe"}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          className={depot.turretArmed ? "btn-quiet mt-4" : "btn mt-4"}
          disabled={disabled || pending}
          onClick={askTurret}
        >
          {depot.turretArmed ? "Disarm it" : "Arm it"}
        </button>
      </section>

      {dialog?.kind === "refuel" && (
        <RequestDialog
          open
          title={`Feed the generator ${dialog.name}`}
          submitLabel="Shovel it in"
          busy={pending}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={submitRefuel}
        >
          <label className="field">
            <span className="field-label">How many</span>
            <input
              type="number"
              min="1"
              max={dialog.held}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            {dialog.perUnit} units each, and the tank holds {depot.fuelMax}. Anything over the top
            is wasted.
          </p>
        </RequestDialog>
      )}

      {dialog?.kind === "power" && (
        <RequestDialog
          open
          title={depot.generatorOn ? "Shut the generator down" : "Fire the generator up"}
          submitLabel="Confirm"
          busy={pending}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={submitPower}
        >
          <p className="text-sm text-muted">
            {depot.generatorOn
              ? "The lights go out and the Depot stops working until it is running again. It also stops burning fuel."
              : "The lights come up and it starts burning fuel again."}
          </p>
        </RequestDialog>
      )}

    </div>
  );
}
