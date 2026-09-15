"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { untilLabel } from "@/lib/turnFormat";
import { readDraft, writeDraft, clearDraft } from "./moveDraft";
import { submitMove, editMyMove, withdrawMyMove, moveContext } from "./actions";

// Filing the one Move a turn: the @@unique([characterId, turnId]) row IS the turn.
//
// Two kinds, and they behave differently once filed. A LABOR settles on the press — the
// ⬢ lands, the day is spent, and there is nothing left to take back. A GAMBIT is the one
// thing in the game that stays pending: the die isn't thrown until Moves lock
// (db/lib/gambitCutoff.js), so until then this same dialog reopens on it to rewrite or
// withdraw it. `existing` is what puts it in that mode.
//
// The dialog still front-loads everything a player needs BEFORE the press — a Labor is
// final, and a server refusal is answered here while there's something to do about it.
// Nothing here is a tooltip (SHEET.md).

// Word for word from the Discord modal's radio group (bot/src/lib/moveModal.js). If the wording changes, change it in both places.
export const MOVE_KINDS = [
  { value: "GAMBIT", label: "Gambit", help: "An action affected by chance." },
  { value: "LABOR", label: "Labor", help: "Produce resources using your best laboring skill." },
];

// ROUTINE is no longer a kind anybody picks, but plenty of rows still carry it — every
// Move the game filed on a player's behalf — so it still needs a word here.
const FILED_FOR_YOU = "Move";

export function moveKindLabel(kind) {
  return MOVE_KINDS.find((entry) => entry.value === kind)?.label ?? FILED_FOR_YOU;
}

// db/lib/moves.js#DESCRIPTION_MAX. Counter turns at nine tenths, the last
// point a player can shorten a paragraph rather than discover "too long" with the turn on the line.
const BODY_MAX = 2000;
const BODY_WARN = Math.floor(BODY_MAX * 0.9);

export default function MoveDialog({ turn = null, characterId = null, existing = null, onClose, onDone }) {
  // Editing a filed Gambit rather than writing a new Move. The kind is settled in that
  // case — swapping to Labor would pay out, and a dialog that both edits and pays is two
  // dialogs. Take it back and file again instead.
  const editing = Boolean(existing);
  // No default when filing fresh: a Move must never be silently filed as the wrong kind.
  const [kind, setKind] = useState(editing ? "GAMBIT" : null);
  // The filed words when editing; otherwise whatever was typed and never filed. Read once,
  // since the dialog mounts on a click and unmounts on close.
  const [body, setBody] = useState(() => existing?.description ?? readDraft(characterId, turn?.number));
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
  // Only applies to Labor — a Gambit files from anywhere.
  const laborRefusal = kind === "LABOR" ? (context?.refusal ?? null) : null;
  const canFile = Boolean(kind) && Boolean(body.trim()) && !pending && !shut && !laborRefusal && body.length <= BODY_MAX;

  async function file() {
    if (!canFile) return;
    if (editing) {
      // No confirm: rewriting a Gambit that hasn't locked changes nothing that can't be
      // changed straight back. The confirm below is for the press that spends the day.
      run(editMyMove, { actionId: existing.id, description: body }, {
        onOk: (res) => {
          onDone(res);
          onClose();
        },
      });
      return;
    }
    // Resolved BEFORE run(): awaiting a confirm inside startTransition deadlocks (DESIGN-SYSTEM.md).
    const sure = await confirm(
      kind === "LABOR"
        ? {
            title: "Labor?",
            message: "You are paid immediately after declaring your labor.",
            confirmLabel: "Yes",
            cancelLabel: "No",
          }
        : { title: "Declare this Gambit?", confirmLabel: "Yes", cancelLabel: "No" },
    );
    if (!sure) return;
    run(submitMove, { moveKind: kind, description: body }, {
      onOk: (res) => {
        clearDraft();
        onDone(res);
        onClose();
      },
    });
  }

  async function withdraw() {
    // No message line: the title is the whole question, and "your day is yours again" was
    // restating what cancelling obviously does.
    const sure = await confirm({
      title: "Cancel your Gambit?",
      confirmLabel: "Undo",
      cancelLabel: "Keep",
    });
    if (!sure) return;
    run(withdrawMyMove, { actionId: existing.id }, {
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
      title={editing ? "Your Gambit" : "Your Move"}
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
      {/* Nothing to pick when editing: a filed Gambit is already a Gambit. */}
      {!editing && (
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
      )}
      {/* Height reserved either way, so the textarea doesn't jump (DESIGN-SYSTEM §5). */}
      <p className="move-help text-sm text-muted">
        {editing ? "You can edit this until the turn locks." : (chosen?.help ?? " ")}
      </p>

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

      {/* Take it back sits apart from Cancel on purpose: Cancel shuts the dialog and
          changes nothing, this one deletes the Move and hands the day back. Same
          .btn-quiet shape Break off and Stop watching already use. */}
      {editing && (
        <button type="button" className="btn-quiet" disabled={pending || shut} onClick={withdraw}>
          Cancel Gambit
        </button>
      )}

      <div className="modal-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={!canFile} onClick={file}>
          {editing ? "Save" : "Declare"}
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
