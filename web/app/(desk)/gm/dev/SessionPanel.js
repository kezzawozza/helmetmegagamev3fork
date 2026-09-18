"use client";

import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import SubmitButton from "@/app/components/SubmitButton";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { scheduleSession, startSessionNow, closeSessionNow } from "@/app/(app)/gm/dev/gameActions";

// The Sessions panel (docs/systemdocs/SESSIONS.md). A client component for the
// same reasons GameControls.js is one: the actions return { ok, error } rather
// than throwing, and closing a session shuts the game for everybody, which
// deserves a confirm in front of it.
//
// Every time shown and every time typed is America/Chicago, unlabelled,
// because that is simply what time it is in Ravenheart. The strings arrive
// pre-formatted from the server so this never has to agree with it twice.
export default function SessionPanel({ sessions, open, openedAtLabel, closedAtLabel, startAtValue, endAtValue, nextLabel }) {
  const confirm = useConfirm();
  const { run, pending, error } = useActionRunner();

  async function onClose() {
    const ok = await confirm({
      title: "Close the session?",
      message: "The game freezes for everybody until the next one opens. The open turn is kept as it is.",
      confirmLabel: "Close session",
      cancelLabel: "Leave it running",
    });
    if (ok) run(closeSessionNow);
  }

  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <h2 className="section-title">Sessions</h2>
        <p className="ops-lede">
          {!sessions
            ? "The game type is Persistent, so it is always in session. Switch it to Sessions in Configuration to use this."
            : open
              ? `In session since ${openedAtLabel}.`
              : `Not in session${closedAtLabel ? `, since ${closedAtLabel}` : ""}. ${nextLabel}`}
        </p>
      </div>

      <form action={scheduleSession} className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">Next session opens</span>
          <input type="datetime-local" name="sessionStartAt" defaultValue={startAtValue ?? ""} disabled={!sessions} />
        </label>
        <label className="field">
          <span className="field-label">and closes</span>
          <input type="datetime-local" name="sessionEndAt" defaultValue={endAtValue ?? ""} disabled={!sessions} />
        </label>
        <SubmitButton pendingLabel="Saving…" disabled={!sessions}>
          Save schedule
        </SubmitButton>
      </form>

      <div className="ops-actions">
        {open ? (
          <button type="button" className="btn" onClick={onClose} disabled={!sessions || pending}>
            {pending ? "Closing…" : "Close now"}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => run(startSessionNow)} disabled={!sessions || pending}>
            {pending ? "Starting…" : "Start now"}
          </button>
        )}
      </div>

      <FormError>{error}</FormError>
    </section>
  );
}
