"use client";

import { useEffect, useState } from "react";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import ChipPicker from "../ChipPicker";
import NameChips from "../NameChips";
import CheckField from "../CheckField";
import { noticeLine } from "./noticeLines";
import { FULL_NAME_LIMIT } from "@/lib/characterName";
import {
  loadIntercept,
  setIntercept,
  stopIntercept,
  releaseHeld,
} from "@/app/(app)/character/interceptActions";

// Laying in wait (docs/systemdocs/INTERCEPT.md). Re-openable and editable: it
// loads whatever watch is already set and Save overwrites it.
//
// NOTHING HERE IS A TOOLTIP. Both modes print their sentence on the page, both
// at once rather than only the chosen one, and the "any person" note reads
// under the chips. That is SHEET.md §3's rule for this surface, and it is why
// the dialog is a column of short paragraphs rather than a row of ⓘ icons.

const MODES = [
  { id: "SAFE", label: "Safe" },
  { id: "AMBUSH", label: "Ambush" },
];

// Bascinet's words, both of them. Ambush needed rewriting once it became a
// real attack (docs/systemdocs/ATTACK.md §4): the ambusher is held too now,
// and calling it off is Break off in the Attack dialog rather than a Release
// in this one.
const MODE_HELP = {
  SAFE: "Freezes them for two minutes and sends them the message.",
  AMBUSH:
    "You attack whoever enters the location. Neither of you can move until the end of the turn. Make sure to declare a Gambit with your intention.",
};

export default function InterceptDialog({ mode: verb, onDone, onClose }) {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("SAFE");
  const [message, setMessage] = useState("");
  const [names, setNames] = useState([]);
  const [anyConcealed, setAnyConcealed] = useState(false);
  const [anyPerson, setAnyPerson] = useState(false);
  const [outsideZoneOnly, setOutsideZoneOnly] = useState(false);
  const [autoSearch, setAutoSearch] = useState(false);
  const [holding, setHolding] = useState([]);
  const [place, setPlace] = useState(null);
  const [limits, setLimits] = useState({ names: 12, message: 300 });
  // Whether a watch actually EXISTS server-side, as opposed to whether this
  // form currently describes one. Stop watching hangs off this: clearing the
  // name chips must not take away the only way out of a live watch.
  const [hasWatch, setHasWatch] = useState(false);
  const { submit, busy, error } = useSubmit();

  useEffect(() => {
    let live = true;
    loadIntercept()
      .then((res) => {
        if (!live || !res?.ok) return;
        setLimits(res.limits ?? { names: 12, message: 300 });
        setHolding(res.holding ?? []);
        setHasWatch(Boolean(res.watch));
        if (res.watch) {
          setMode(res.watch.mode);
          setMessage(res.watch.message);
          setNames(res.watch.names);
          setAnyConcealed(res.watch.anyConcealed);
          setAnyPerson(res.watch.anyPerson);
          setOutsideZoneOnly(Boolean(res.watch.outsideZoneOnly));
          setAutoSearch(Boolean(res.watch.autoSearch));
          setPlace(res.watch.place ?? null);
        }
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const watching = anyPerson || anyConcealed || names.length > 0;

  return (
    <ActionDialog
      title="Intercept"
      submitLabel="Save"
      busy={busy}
      error={error}
      loading={loading}
      canSubmit={watching}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => setIntercept({ mode, message, names, anyConcealed, anyPerson, outsideZoneOnly, autoSearch }),
          (res) => onDone(noticeLine(verb, res)),
        )
      }
    >
      {place ? <p className="text-sm text-muted">{`You are lying in wait at ${place}.`}</p> : null}

      {/* The two standing rules sit ABOVE the typed names rather than mixed in
          with them: ✕ has to mean exactly one thing in a chip row, and "anyone
          who comes" is not a name somebody typed. */}
      <div className="field">
        <span className="field-label">Who do you want to intercept?</span>
        <div className="chip-row" role="group" aria-label="Who do you want to intercept?">
          <button
            type="button"
            className="chip"
            data-active={anyPerson ? "true" : undefined}
            aria-pressed={anyPerson}
            onClick={() => setAnyPerson((on) => !on)}
          >
            Any person
          </button>
          <button
            type="button"
            className="chip"
            data-active={anyConcealed ? "true" : undefined}
            aria-pressed={anyConcealed}
            disabled={anyPerson}
            onClick={() => setAnyConcealed((on) => !on)}
          >
            Any concealed person
          </button>
          {/* Not a "who" — it narrows whichever who you picked, names included, so
              "Any person" does not subsume it the way it subsumes the chip above and
              this one never greys out. */}
          <button
            type="button"
            className="chip"
            data-active={outsideZoneOnly ? "true" : undefined}
            aria-pressed={outsideZoneOnly}
            onClick={() => setOutsideZoneOnly((on) => !on)}
          >
            Only from outside the zone
          </button>
        </div>
        <p className="text-xs text-muted">
          Off, you stop everyone who walks in. On, only people who came from another zone — so
          the locals pass by.
        </p>
      </div>

      <NameChips
        label="…or by name"
        names={names}
        onChange={setNames}
        max={limits.names}
        maxLength={FULL_NAME_LIMIT}
        disabled={anyPerson}
      />

      <label className="field">
        <span className="field-label">What do you want to message them?</span>
        <textarea
          rows={2}
          value={message}
          maxLength={limits.message}
          placeholder="Halt, in the name of the Baron!"
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>

      <ChipPicker label="How?" options={MODES} value={mode} onChange={(id) => setMode(id || "SAFE")} />
      <p className="text-xs text-muted">
        <strong>Safe.</strong> {MODE_HELP.SAFE}
      </p>
      <p className="text-xs text-muted">
        <strong>Ambush.</strong> {MODE_HELP.AMBUSH}
      </p>

      {/* Under the mode picker, NOT up in the dragnet row with the other three
          toggles. Those say WHO this watch catches, and "Only from outside the
          zone" narrows whichever who you picked — this says what happens once
          you already have them, which is a different question and does not
          belong in a row of answers to the first one.

          It never greys: it asks nothing of your sheet and says nothing about
          the room. And nothing in this dialog is a tooltip (SHEET.md §3), so
          the sentence under it prints. */}
      <div className="field">
        <CheckField checked={autoSearch} onChange={(e) => setAutoSearch(e.target.checked)}>
          Automatically search?
        </CheckField>
        <p className="text-xs text-muted">
          On, anyone you stop is also asked to be searched. They can still say no, and they
          still get to hide things first.
        </p>
      </div>

      {holding.length > 0 ? (
        <div className="field">
          <span className="field-label">You are holding</span>
          {holding.map((row) => (
            <div key={row.id} className="chip-row">
              <span className="text-sm">{row.name}</span>
              <button
                type="button"
                className="btn-quiet"
                disabled={busy}
                onClick={() =>
                  submit(
                    () => releaseHeld({ targetCharacterId: row.id }),
                    (res) => {
                      setHolding((rows) => rows.filter((r) => r.id !== row.id));
                      onDone(res.line);
                    },
                  )
                }
              >
                Let them go
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {watching || hasWatch ? (
        <button
          type="button"
          className="btn-quiet"
          disabled={busy}
          onClick={() => submit(() => stopIntercept(), (res) => onDone(res.line))}
        >
          Stop watching
        </button>
      ) : null}
    </ActionDialog>
  );
}
