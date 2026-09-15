"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { untilLabel } from "@/lib/turnFormat";
import { readDraft, writeDraft, clearDraft } from "./moveDraft";
import { submitMove, moveContext } from "./actions";

// Filing the one Move a turn: the @@unique([characterId, turnId]) row IS the
// turn, and a filed Move is final. Because it's final, the dialog's job is to
// put everything a player needs BEFORE the press — every server refusal is
// answered on the page while there's still something to do about it. Nothing here is a tooltip (SHEET.md).

// Word for word from the Discord modal's radio group (bot/src/lib/moveModal.js). If the wording changes, change it in both places.
export const MOVE_KINDS = [
  { value: "ROUTINE", label: "Routine", help: "Easy — it resolves itself." },
  { value: "GAMBIT", label: "Gambit", help: "Could go either way — rolls a die." },
  { value: "LABOR", label: "Labor", help: "Work the day using your best Labor skill." },
];

export function moveKindLabel(kind) {
  return MOVE_KINDS.find((entry) => entry.value === kind)?.label ?? "Move";
}

// db/lib/moves.js#DESCRIPTION_MAX. Counter turns at nine tenths, the last
// point a player can shorten a paragraph rather than discover "too long" with the turn on the line.
const BODY_MAX = 2000;
const BODY_WARN = Math.floor(BODY_MAX * 0.9);

export default function MoveDialog({ turn = null, characterId = null, onClose, onDone }) {
  // No default: a Move must never be silently filed as Routine.
  const [kind, setKind] = useState(null);
  // Whatever was typed and never filed. Read once, since the dialog mounts on a click and unmounts on close.
  const [body, setBody] = useState(() => readDraft(characterId, turn?.number));
  const [context, setContext] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();
  const chosen = MOVE_KINDS.find((k) => k.value === kind);
  const live = useRef(true);

  // Same minute hand the turn card runs on, so a dialog open across the cutoff must stop saying there's time left.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Asked once on open rather than at page render, same posture as useRoster.
  useEffect(() => {
    live.current = true;
    moveContext()
      .then((res) => {
        if (live.current && res?.ok) setContext(res);
      })
      .catch(() => {
        // No readout is a worse dialog, not a broken one — server re-checks on submit regardless.
      });
    return () => {
      live.current = false;
    };
  }, []);

  const countdown = turn?.locked ? "locked" : untilLabel(turn?.closesAt, now);
  const shut = Boolean(turn?.locked) || countdown === "locked";
  // Only applies to Labor — a Routine or Gambit files from anywhere.
  const laborRefusal = kind === "LABOR" ? (context?.refusal ?? null) : null;
  const canFile = Boolean(kind) && Boolean(body.trim()) && !pending && !shut && !laborRefusal && body.length <= BODY_MAX;

  async function file() {
    if (!canFile) return;
    // Resolved BEFORE run(): awaiting a confirm inside startTransition deadlocks (DESIGN-SYSTEM.md).
    const sure = await confirm({
      title: "File this Move?",
      confirmLabel: "Lock in",
      cancelLabel: "Not yet",
    });
    if (!sure) return;
    run(submitMove, { moveKind: kind, description: body }, {
      onOk: (res) => {
        clearDraft();
        onDone(res);
        onClose();
      },
    });
  }

  return (
    <Modal
      open
      title="Your Move"
      onClose={onClose}
      actions={
        countdown ? (
          <span
            className="chip chip-mono"
            data-tone={shut ? "danger" : undefined}
            suppressHydrationWarning
          >
            {countdown}
          </span>
        ) : null
      }
    >
      <div className="chip-row" role="radiogroup" aria-label="What kind of Move">
        {MOVE_KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="radio"
            className="chip"
            data-active={kind === entry.value ? "true" : undefined}
            aria-checked={kind === entry.value}
            // Must not take opening focus: Space on a fresh dialog would silently change the kind.
            tabIndex={(kind ?? MOVE_KINDS[0].value) === entry.value ? 0 : -1}
            onClick={() => setKind(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="move-help text-sm text-muted">{chosen?.help ?? " "}</p>

      {kind === "LABOR" && context && (
        <LaborReadout context={context} />
      )}

      <div className="field">
        <label className="field-label" htmlFor="chat-move">
          What do you do?
        </label>
        <textarea
          id="chat-move"
          rows={6}
          value={body}
          maxLength={BODY_MAX}
          data-autofocus="true"
          disabled={shut}
          onChange={(e) => {
            setBody(e.target.value);
            writeDraft(characterId, turn?.number, e.target.value);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              file();
            }
          }}
        />
      </div>

      <span
        className="mono text-sm move-count"
        data-tone={body.length >= BODY_WARN ? "danger" : undefined}
      >
        {body.length}/{BODY_MAX}
      </span>

      {shut && (
        <p className="form-error" role="alert">
          Moves were locked.
        </p>
      )}
      <FormError>{error}</FormError>

      <div className="modal-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={!canFile} onClick={file}>
          Lock In
        </button>
      </div>
    </Modal>
  );
}

// What the ground is worth, in Examine's words. Never a number — Examine is
// the only surface allowed to show a coefficient (db/lib/laborYield.js, LABORING.md).
function LaborReadout({ context }) {
  return (
    <div className="move-labor">
      {/* Stands on its own rather than inside a sentence: an article reading right for the Woods reads wrong for Last Chance. */}
      {context.locationName && <p className="move-labor-where">{context.locationName}</p>}

      {context.refusal ? (
        <p className="form-error" role="alert">
          {context.refusal}
        </p>
      ) : context.refining ? (
        /* A refinery pays in goods, not ⬢ — no yield words or tools to list (db/lib/laborAccess.js). */
        <>
          <p className="move-labor-best">
            You would labor at the <strong>{context.tier}</strong> tier.
          </p>
          <p className="text-sm text-muted">{context.refining}</p>
        </>
      ) : (
        <>
          <p className="move-labor-best">
            You would labor at the <strong>{context.tier}</strong> tier.
          </p>
          <ul className="move-labor-yields">
            {context.yields.map((row) => (
              <li key={row.label}>
                {row.label} <span className="move-labor-word">{row.word}</span>
              </li>
            ))}
          </ul>
          {context.tools.length > 0 && (
            <p className="text-sm text-muted">Includes {context.tools.join(", ")}.</p>
          )}
        </>
      )}
    </div>
  );
}
