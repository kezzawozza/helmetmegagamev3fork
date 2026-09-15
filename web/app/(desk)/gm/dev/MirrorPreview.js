"use client";

// "Preview mirror" — what the Discord mirror would do, if it were allowed to do
// anything yet.
//
// db/lib/discordMirror reads the database, reads the guild once, and lists
// every place the two disagree. Phase 0 makes no Discord writes at all, so this
// button is safe to press on a live game: the worst it costs is a handful of
// read calls and one SystemReport row.
//
// A run against a freshly synced world should come back empty. Anything else is
// either real drift or a place where the mirror and db:sync-zones disagree about
// what the world should look like, and both are worth seeing before the mirror
// is handed the keys in Phase 1.
import { useState, useTransition } from "react";

import EmptyState from "@/app/components/EmptyState";
import FormError from "@/app/components/FormError";
import { previewMirrorAction } from "@/app/(app)/gm/dev/actions";

const SHOWN = 60;

export default function MirrorPreview() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function preview(scope) {
    setError(null);
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

  const clean = result && result.ops.length === 0 && result.findings.length === 0;

  return (
    <div className="panel">
      <p className="ops-lede">
        What the reconciler would change if it were switched on. It reads and reports; it writes
        nothing to Discord.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => preview("structure")}
          disabled={pending}
        >
          {pending ? "Looking…" : "Preview mirror"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => preview("full")}
          disabled={pending}
        >
          Preview everything
        </button>
      </div>

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

      {!result && !error ? <EmptyState>Nothing previewed yet.</EmptyState> : null}
    </div>
  );
}
