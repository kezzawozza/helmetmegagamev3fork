"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import ChipPicker from "../ChipPicker";
import { useConfirm } from "../ConfirmProvider";
import useSubmit from "./useSubmit";
import {
  loadAttacks,
  attackCharacterRequest,
  cancelAttackRequest,
} from "@/app/(app)/character/attackActions";

// Attacking somebody (docs/systemdocs/ATTACK.md). One person standing here,
// picked from a chip row — BindDialog's shape — plus the list of fights you
// are already in, each with the button that calls it off.
//
// What an attack does is the verb's own help sentence (ACTION_HELP.attack)
// and the confirm dialog's own line, not a second explanation here — the
// dialog itself is just the picker and the list of fights already in progress.
//
// The picker lists everybody here, including the people the button will refuse.
// That is deliberate: filtering them out would answer "who is out of my league"
// to anyone who opened the dialog, which is the one thing docs/systemdocs/
// COMBAT.md §5 is written to prevent. You find out by pressing it.
export default function AttackDialog({ onDone, onClose }) {
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState([]);
  const [fighting, setFighting] = useState([]);
  // Why Attack is refused this turn, or null — resolved server-side by
  // attackActions.js off db/lib/combatGate.js, never re-derived here.
  const [blocked, setBlocked] = useState(null);
  const [targetId, setTargetId] = useState("");
  const confirm = useConfirm();
  const { submit, busy, error } = useSubmit();

  useEffect(() => {
    let live = true;
    loadAttacks()
      .then((res) => {
        if (!live || !res?.ok) return;
        setPeople(res.people ?? []);
        setFighting(res.fighting ?? []);
        setBlocked(res.blocked ?? null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // Anybody you are already fighting is off the picker — the row for them is
  // in the list below, and pressing it again could only ever be refused.
  // Matched on the KEY, not an id: a hooded opponent has no id on either list
  // (db/lib/attack.js#attacksBy), and comparing the two by id would put a mask
  // you are already fighting back in the picker.
  const busyWith = new Set(fighting.map((row) => row.key));
  const options = people.filter((row) => !busyWith.has(row.id));
  const target = options.find((row) => row.id === targetId) ?? null;

  async function onSubmit() {
    if (!target) return;
    const ok = await confirm({
      title: `Attack ${target.name}?`,
      message: "Neither of you can move until the turn ends.",
      confirmLabel: "Attack them",
    });
    if (!ok) return;
    submit(
      () => attackCharacterRequest({ targetKey: target.id }),
      (res) => onDone(res.line),
    );
  }

  return (
    <ActionDialog
      title="Attack"
      busy={busy}
      error={error}
      loading={loading && options.length === 0 && fighting.length === 0}
      empty={!loading && options.length === 0 && fighting.length === 0 ? "There’s nobody here to attack." : null}
      canSubmit={Boolean(target) && !blocked}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      {/* The submit greys, not the icon on the strip: Break off lives in this
          dialog, and a dead button on the sheet would strand anyone who
          attacked and then filed a Routine (docs/systemdocs/ATTACK.md §6). */}
      {blocked ? <p className="text-xs text-muted">{blocked}</p> : null}

      {options.length > 0 ? (
        <ChipPicker
          label="Who are you attacking?"
          options={options.map((row) => ({ id: row.id, label: row.name }))}
          value={targetId}
          onChange={setTargetId}
        />
      ) : null}

      {fighting.length > 0 ? (
        <div className="field">
          <span className="field-label">You are fighting</span>
          {fighting.map((row) => (
            <div key={row.key} className="chip-row">
              <span className="text-sm">{row.name}</span>
              <button
                type="button"
                className="btn-quiet"
                disabled={busy}
                onClick={() =>
                  submit(
                    () => cancelAttackRequest({ targetKey: row.key }),
                    (res) => {
                      setFighting((rows) => rows.filter((r) => r.key !== row.key));
                      onDone(res.line);
                    },
                  )
                }
              >
                Break off
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ActionDialog>
  );
}
