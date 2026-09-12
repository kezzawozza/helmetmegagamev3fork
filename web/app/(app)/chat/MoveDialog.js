"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { untilLabel } from "@/lib/turnFormat";
import { readDraft, writeDraft, clearDraft } from "./moveDraft";
import { submitMove, moveContext } from "./actions";

// Filing the one Move a turn. It never asks twice, and there is nothing to
// come back to: the @@unique([characterId, turnId]) row IS the turn, and a
// filed Move is final. This dialog used to double as an editor with a
// once-a-turn cap on changing the kind; the rule now is that you get one Move
// and it stands.
//
// Because it is final, the dialog's job is to put everything a player needs
// BEFORE the press rather than after it. It used to be three chips and a bare
// box, and every refusal the server knows — the window has shut, you cannot
// labor where you stand, that is too long — was something you found out by
// spending the press. Each one is now answered on the page while there is
// still something to do about it. Nothing here is a tooltip (SHEET.md).

// The three help lines are Bascinet's own, word for word from the Discord
// modal's radio group (bot/src/lib/moveModal.js) — so a player reads the same
// sentence whichever face they file from. If the wording changes, change it
// in both places.
export const MOVE_KINDS = [
  { value: "ROUTINE", label: "Routine", help: "Easy — it resolves itself." },
  { value: "GAMBIT", label: "Gambit", help: "Could go either way — rolls a die." },
  { value: "LABOR", label: "Labor", help: "Work the day using your best Labor skill." },
];

export function moveKindLabel(kind) {
  return MOVE_KINDS.find((entry) => entry.value === kind)?.label ?? "Move";
}

// db/lib/moves.js#DESCRIPTION_MAX. The counter turns at nine tenths of it,
// which is the last point where a player can still shorten a paragraph rather
// than discover "That's too long." with the turn on the line.
const BODY_MAX = 2000;
const BODY_WARN = Math.floor(BODY_MAX * 0.9);

export default function MoveDialog({ turn = null, characterId = null, onClose, onDone }) {
  // No default: a player who never notices this row must not have their Move
  // silently filed as Routine. Lock In stays disabled until one is picked.
  const [kind, setKind] = useState(null);
  // Whatever was typed into this turn's box and never filed. Read once, here,
  // because the dialog mounts on a click and unmounts on close.
  const [body, setBody] = useState(() => readDraft(characterId, turn?.number));
  const [context, setContext] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();
  const chosen = MOVE_KINDS.find((k) => k.value === kind);
  const live = useRef(true);

  // The same minute hand the turn card runs on. A dialog left open across the
  // cutoff must stop saying there is time left.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // What the ground here is worth, asked once on open rather than when the
  // page rendered — the same posture useRoster takes, and for the same reason:
  // the world is looked at when the player asks to act on it.
  useEffect(() => {
    live.current = true;
    moveContext()
      .then((res) => {
        if (live.current && res?.ok) setContext(res);
      })
      .catch(() => {
        // No readout is a worse dialog, not a broken one — the server re-runs
        // every one of these checks on submit regardless.
      });
    return () => {
      live.current = false;
    };
  }, []);

  const countdown = turn?.locked ? "locked" : untilLabel(turn?.closesAt, now);
  // Shut either because the poll said so or because the browser's own clock
  // has walked past the cutoff while this sat open.
  const shut = Boolean(turn?.locked) || countdown === "locked";
  // The one refusal that is knowable before the press. It only applies to
  // Labor — a Routine or a Gambit files from anywhere.
  const laborRefusal = kind === "LABOR" ? (context?.refusal ?? null) : null;
  const canFile = Boolean(kind) && Boolean(body.trim()) && !pending && !shut && !laborRefusal && body.length <= BODY_MAX;

  async function file() {
    if (!canFile) return;
    // Resolved BEFORE run(), never inside the transition it opens — awaiting a
    // confirm inside startTransition deadlocks (DESIGN-SYSTEM.md).
    const sure = await confirm({
      title: "File this Move?",
      confirmLabel: "Lock In",
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
          // The server's minute and the browser's are not the same minute.
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
            // The chips must not take the opening focus: Modal picks the first
            // focusable when nothing is marked, and Space on a freshly opened
            // dialog would silently change the kind.
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
          // Modal focuses this rather than the first chip.
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

      {/* The counter is the whole footer now. It was a row of two, with a line
          of guidance beside it, and the flex rules below it went with that. */}
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

// What the ground under this character is worth, in the words the Examine
// button already uses. Never a number: working out that Bountiful beats Ample
// is the player's job, and Examine is the only surface allowed to show a
// coefficient at all (db/lib/laborYield.js, LABORING.md).
//
// The refusal is the important half. resolveLaborRate has always known that a
// character holds no Laboring skill, or none that reaches where they stand —
// it just used to say so only after the press.
function LaborReadout({ context }) {
  return (
    <div className="move-labor">
      {/* The place name stands on its own rather than inside a sentence: an
          article that reads right for the Woods reads wrong for Last Chance,
          and the Locations are named both ways. */}
      {context.locationName && <p className="move-labor-where">{context.locationName}</p>}

      {context.refusal ? (
        <p className="form-error" role="alert">
          {context.refusal}
        </p>
      ) : context.refining ? (
        /* A refinery pays in goods, not ⬢, and it is the one Location with no
           LocationYield rows behind it — so the four quality words below would
           all read the same nothing, and there are no tools to list either
           (db/lib/laborAccess.js's refinery branch returns neither). What the
           shift makes is the whole story, which is what the sentence says. */
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
