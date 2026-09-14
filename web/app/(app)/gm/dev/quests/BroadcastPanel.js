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
import { useConfirm } from "@/app/components/ConfirmProvider";
import { sendAmbientLine } from "@/app/(app)/gm/dev/actions";
import GatePicker from "./GatePicker";

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
  // Only a zone the picker actually offers. A cave has no #summary channel, so
  // it is never in this list — and a quest usually lives in a cave. Seeding
  // the raw id anyway ticked nothing, said "0 of 5 picked", and still lit up
  // Say it, which then failed with "Nothing went out."
  const offered = Boolean(prefill?.zoneId) && zones.some((z) => z.id === prefill.zoneId);
  const [picked, setPicked] = useState(offered ? [prefill.zoneId] : []);
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
    <div className="desk-card grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* The same picker the quest gates use, so Everywhere / None / the count
          are one implementation rather than a bespoke header button. */}
      <GatePicker
        label="Where it goes"
        items={zones}
        value={picked}
        onChange={setPicked}
        allLabel="Everywhere"
        emptyLabel="No zone matches."
        filterPlaceholder="Zone name…"
      />

      <div className="flex min-w-0 flex-col gap-3">
        {prefill && !offered ? (
          <p className="text-sm text-muted">
            {prefill.zoneName ?? "That zone"} has no summary channel to advertise into — pick
            somewhere the word would travel from instead.
          </p>
        ) : null}

        <div className="field">
          <label className="field-label" htmlFor="broadcast-text">
            The line
          </label>
          <textarea
            id="broadcast-text"
            rows={3}
            value={text}
            // Only on the remount an Advertise caused — prefill is null on a
            // plain visit, so opening the tab never steals focus.
            autoFocus={Boolean(prefill)}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {/* Always drawn, never conditional: a preview that appears on the first
            keystroke shoves Say it down the page mid-sentence
            (DESIGN-SYSTEM.md §5, "reserve the space a conditional line will
            take"). */}
        <div className="field">
          <span className="field-label">What they read</span>
          <div className="panel p-3">
            <pre className="mono whitespace-pre-wrap break-words text-sm">
              {text.trim() ? preview : <span className="text-muted">Nothing yet.</span>}
            </pre>
          </div>
        </div>

        <div className="ops-actions">
          <button
            type="button"
            className="btn"
            disabled={pending || picked.length === 0 || !text.trim()}
            onClick={send}
          >
            {pending ? "Saying it…" : "Say it"}
          </button>
          {note ? <span className="self-center text-sm text-muted">{note}</span> : null}
          <FormError>{error}</FormError>
        </div>
      </div>
    </div>
  );
}
