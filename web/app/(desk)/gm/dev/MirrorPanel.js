"use client";

// The Discord mirror, on the Dev Panel.
//
// Preview reads the database, reads the guild once, and lists every place the
// two disagree — no writes, safe to press on a live game. Reconcile now is the
// same comparison with the writes turned on: it creates what is missing,
// adopts a same-named object before it would cut a second, reparents, renames,
// and rewrites a room starter that has drifted from its row. It runs in the
// background and lands as a MIRROR report in the list below.
//
// The queue line is the other half. A save on a GM surface does not wait for
// Discord; it files a MirrorJob and the mirror catches up. "Waiting" is normal
// and usually clears in seconds. "Retrying" is not: it means a pass has failed
// at least once, and the breaker line says whether Discord is refusing calls.
import { useState, useTransition } from "react";

import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { previewMirrorAction, reconcileMirrorAction } from "@/app/(app)/gm/dev/actions";

const SHOWN = 60;

export default function MirrorPanel({ queue = null }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const confirm = useConfirm();

  function preview(scope) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await previewMirrorAction({ scope });
      if (!res?.ok) {
        setResult(null);
        setError(res?.error ?? "The mirror could not read the guild.");
        return;
      }
      setResult(res);
    });
  }

  async function reconcile() {
    const ok = await confirm({
      title: "Reconcile Discord now?",
      message:
        "The mirror will create, rename and reparent Discord objects until the guild matches the database, then reconcile who can see what. It runs in the background; the MIRROR report below says what it did.",
      confirmLabel: "Reconcile",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await reconcileMirrorAction();
      setNote(res?.ok ? "Reconciling. The MIRROR report below updates when it finishes." : null);
      if (!res?.ok) setError("The mirror could not start.");
    });
  }

  const clean = result && result.ops.length === 0 && result.findings.length === 0;

  return (
    <div className="panel">
      <p className="ops-lede">
        What the database says Discord should look like, against what it actually holds. Preview
        reads and reports; Reconcile now rewrites the guild.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => preview("structure")}
          disabled={pending}
        >
          {pending ? "Working…" : "Preview mirror"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => preview("full")}
          disabled={pending}
        >
          Preview everything
        </button>
        <button type="button" className="btn" onClick={reconcile} disabled={pending}>
          Reconcile now
        </button>
      </div>

      {queue ? (
        <>
          <p className="ops-report-detail">
            {queue.pending > 0 ? (
              <>
                <strong>{queue.pending}</strong> place{queue.pending === 1 ? "" : "s"} waiting for
                Discord
                {queue.retried > 0 ? (
                  <>
                    {" · "}
                    <strong>{queue.retried}</strong> retrying
                  </>
                ) : null}
                {queue.givenUp > 0 ? (
                  <>
                    {" · "}
                    <strong>{queue.givenUp}</strong> given up on
                  </>
                ) : null}
              </>
            ) : (
              "Nothing is waiting for Discord."
            )}
            {queue.breakerOpen ? (
              <>
                {" — "}
                <strong>Discord calls are suspended</strong>: too many refusals, so the circuit breaker
                is open and the queue is not draining.
              </>
            ) : null}
          </p>
          {queue.jobs?.length > 0 ? (
            <ul className="text-xs list-disc pl-5">
              {queue.jobs.map((job) => (
                <li key={`${job.targetType}-${job.targetId}`}>
                  <span className="mono">
                    {job.targetType}:{job.targetId}
                  </span>{" "}
                  · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}
                  {job.error ? <> · {job.error}</> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {note ? <p className="ops-report-detail">{note}</p> : null}
      <FormError>{error}</FormError>

      {clean ? (
        <p className="ops-report-detail">Discord matches the database. Nothing to do.</p>
      ) : null}

      {result && !clean ? (
        <>
          <p className="ops-report-detail">
            <strong>{result.ops.length}</strong> op{result.ops.length === 1 ? "" : "s"} ·{" "}
            <strong>{result.findings.length}</strong> finding
            {result.findings.length === 1 ? "" : "s"} · {result.scope}
          </p>
          {result.ops.length > 0 ? (
            <ul className="text-xs list-disc pl-5">
              {result.ops.slice(0, SHOWN).map((op, i) => (
                <li key={`${op.targetId}-${i}`}>
                  <span className="mono">{op.kind}</span> — {op.reason}
                </li>
              ))}
              {result.ops.length > SHOWN ? (
                <li className="text-muted">…and {result.ops.length - SHOWN} more.</li>
              ) : null}
            </ul>
          ) : null}
          {result.findings.length > 0 ? (
            <ul className="text-xs list-disc pl-5">
              {result.findings.slice(0, SHOWN).map((f, i) => (
                <li key={`${f.target}-${i}`}>
                  <span className="mono">{f.check}</span> · {f.target}: {f.problem}
                </li>
              ))}
              {result.findings.length > SHOWN ? (
                <li className="text-muted">…and {result.findings.length - SHOWN} more.</li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : null}

      {!result && !error && !note ? <EmptyState>Nothing previewed yet.</EmptyState> : null}
    </div>
  );
}
