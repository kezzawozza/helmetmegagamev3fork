"use client";

import { useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { untilLabel } from "@/lib/turnFormat";
import { readDraft, writeDraft, clearDraft } from "./moveDraft";
import { submitMove, editMyMove, withdrawMyMove } from "./actions";

// Filing the one Move a turn: the @@unique([characterId, turnId]) row IS the turn.
//
// A Move IS a Gambit, and the one thing in the game that stays pending: the die isn't thrown until Moves
// lock (db/lib/gambitCutoff.js), so until then this same dialog reopens on it to rewrite
// or withdraw it. `existing` is what puts it in that mode.
//
// Nothing here is a tooltip (SHEET.md).

// Word for word from the Discord modal (bot/src/lib/moveModal.js). If the wording changes, change it in both places.
const GAMBIT_HELP = "An action affected by chance.";

// ROUTINE is no longer a kind anybody picks, but plenty of rows still carry it — every
// Move the game filed on a player's behalf — so it still needs a word here.
const FILED_FOR_YOU = "Move";

export function moveKindLabel(kind) {
  return kind === "GAMBIT" ? "Gambit" : FILED_FOR_YOU;
}

// db/lib/moves.js#DESCRIPTION_MAX. Counter turns at nine tenths, the last
// point a player can shorten a paragraph rather than discover "too long" with the turn on the line.
const BODY_MAX = 2000;
const BODY_WARN = Math.floor(BODY_MAX * 0.9);

export default function MoveDialog({ turn = null, characterId = null, existing = null, onClose, onDone }) {
  // Editing a filed Gambit rather than writing a new Move.
  const editing = Boolean(existing);
  // The filed words when editing; otherwise whatever was typed and never filed. Read once,
  // since the dialog mounts on a click and unmounts on close.
  const [body, setBody] = useState(() => existing?.description ?? readDraft(characterId, turn?.number));
  const [now, setNow] = useState(() => Date.now());
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();

  // Same minute hand the turn card runs on, so a dialog open across the cutoff must stop saying there's time left.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const countdown = turn?.shut ? "not in session" : turn?.locked ? "locked" : untilLabel(turn?.closesAt, now);
  // `shut` has to read turn.shut separately: out of session `locked` is false, because freezing the clock removes the
  // deadline rather than shutting the game (db/lib/turnGate.js).
  const shut = Boolean(turn?.shut) || Boolean(turn?.locked) || countdown === "locked";
  const shutReason = turn?.shut ? (turn.shutReason ?? "The game isn't in session.") : "Moves were locked.";
  const canFile = Boolean(body.trim()) && !pending && !shut && body.length <= BODY_MAX;

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
    const sure = await confirm({ title: "Declare this Gambit?", confirmLabel: "Yes", cancelLabel: "No" });
    if (!sure) return;
    run(submitMove, { moveKind: "GAMBIT", description: body }, {
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
      {/* Height reserved either way, so the textarea doesn't jump (DESIGN-SYSTEM §5). */}
      <p className="move-help text-sm text-muted">
        {editing ? "You can edit this until the turn locks." : GAMBIT_HELP}
      </p>

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
          {shutReason}
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
