"use client";

// Advertising: one line into as many zone #summary channels as you tick.
//
// This is the existing sendAmbientLine, called once per zone rather than once,
// and that is the whole difference. It stays ambient `-#` subtext and it does
// NOT reach for db/lib/intercom.js — a quest advert is scenery somebody
// notices, not a loudspeaker with an @here on it. The intercom is the
// deliberate exception in CLAUDE.md and a poster is not it.
//
// Sequential, never Promise.all: fanning out to a dozen zones at once is how a
// bot earns a rate-limit ban, which is the same reason broadcastIntercom walks
// its list one at a time.
import { useMemo, useState, useTransition } from "react";

import FormError from "@/app/components/FormError";
import CheckField from "@/app/components/CheckField";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { sendAmbientLine } from "@/app/(app)/gm/dev/actions";

export default function BroadcastPanel({ zones, prefill }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  // The Advertise button on a quest lands here with the zone already ticked
  // and a line already written — which is the reason these three tabs share a
  // panel at all. It arrives as the INITIAL state rather than through an
  // effect: QuestsSection keys this component on the prefill, so a second
  // Advertise remounts it instead of syncing state to a prop
  // (react-hooks/set-state-in-effect is an error in this repo).
  const [picked, setPicked] = useState(prefill?.zoneId ? [prefill.zoneId] : []);
  const [text, setText] = useState(prefill?.text ?? "");

  // Mirrors db/lib/ambientLine.js exactly: `-#` is per LINE, so a two-line
  // advert typed by hand comes out half subtext and half shouting.
  const preview = useMemo(
    () =>
      text
        .split("\n")
        .map((l) => `-# ${l}`)
        .join("\n"),
    [text],
  );

  const all = picked.length === zones.length && zones.length > 0;

  function toggle(zoneId) {
    setPicked((prev) => (prev.includes(zoneId) ? prev.filter((z) => z !== zoneId) : [...prev, zoneId]));
  }

  async function send() {
    setError(null);
    setNote(null);
    const names = zones.filter((z) => picked.includes(z.id)).map((z) => z.label);
    const ok = await confirm({
      title: all ? "Say this everywhere?" : `Say this in ${names.join(", ")}?`,
      message: "Everyone watching those zones reads it the moment it lands.",
      confirmLabel: "Say it",
      cancelLabel: "Not yet",
    });
    if (!ok) return;

    startTransition(async () => {
      const failed = [];
      for (const zoneId of picked) {
        const res = await sendAmbientLine({ kind: "zone", targetId: zoneId, text });
        if (!res?.ok) failed.push(zones.find((z) => z.id === zoneId)?.label ?? zoneId);
      }
      if (failed.length === picked.length) {
        setError("Nothing went out.");
        return;
      }
      setNote(
        failed.length > 0
          ? `Sent, except in ${failed.join(", ")}.`
          : `Sent to ${picked.length} zone${picked.length === 1 ? "" : "s"}.`,
      );
      setText("");
    });
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Where it goes</span>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => setPicked(all ? [] : zones.map((z) => z.id))}
        >
          {all ? "None" : "Everywhere"}
        </button>
      </div>

      <div className="chip-row">
        {zones.map((zone) => (
          <CheckField key={zone.id}>
            <input type="checkbox" checked={picked.includes(zone.id)} onChange={() => toggle(zone.id)} />
            {zone.label}
          </CheckField>
        ))}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="broadcast-text">
          The line
        </label>
        <textarea id="broadcast-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      {text.trim() ? (
        <div className="field">
          <span className="field-label">What they read</span>
          <pre className="text-sm text-muted">{preview}</pre>
        </div>
      ) : null}

      {note ? <p className="text-sm text-muted">{note}</p> : null}
      <FormError>{error}</FormError>

      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          disabled={pending || picked.length === 0 || !text.trim()}
          onClick={send}
        >
          Say it
        </button>
      </div>
    </div>
  );
}
