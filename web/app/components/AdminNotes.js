"use client";

import { useEffect, useState, useTransition } from "react";
import { EnumPill, ADMIN_NOTE_SEVERITY } from "./StatusPill";
import { useConfirm } from "./ConfirmProvider";
import { ADMIN_NOTE_MAX_LENGTH } from "@/lib/constants";
import { listAdminNotes, addAdminNote, deleteAdminNote } from "./adminNoteActions";

// Moderation notes about a PLAYER, mounted in two places: a tab of the shared
// inspector on /gm/players, and a tab of the Dev Character Panel. One
// component rather than two, which is why it lives here and takes the player's
// id and nothing else — it must not be possible to hand it a character, since
// the notes outlive every character the player has (PLAYER-DESK.md §7).
//
// Fetches for itself on mount, the extraTabs contract SceneTab already
// follows. Both callers key it on discordUserId, so switching person REMOUNTS
// it and there is no stale state to clear.
//
// Every mutation hands back the whole fresh list, so nothing here revalidates
// a route — see the note in adminNoteActions.js.

const LEVELS = ["HIGH", "MEDIUM", "LOW"];

function noteDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminNotes({ discordUserId }) {
  const [state, setState] = useState({ status: "loading", notes: [], error: null });
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("LOW");
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  // setState lands after the await, never synchronously in the effect body
  // (react-hooks/set-state-in-effect is an error in this repo).
  useEffect(() => {
    if (!discordUserId) return undefined;
    let cancelled = false;
    (async () => {
      const res = await listAdminNotes({ discordUserId });
      if (cancelled) return;
      if (res?.ok) setState({ status: "ready", notes: res.notes, error: null });
      else setState({ status: "error", notes: [], error: res?.error ?? "Couldn't load that." });
    })();
    return () => {
      cancelled = true;
    };
  }, [discordUserId]);

  function apply(res) {
    if (res?.ok) {
      setState({ status: "ready", notes: res.notes, error: null });
      return true;
    }
    setState((s) => ({ ...s, error: res?.error ?? "Couldn't save that." }));
    return false;
  }

  function submit() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      if (apply(await addAdminNote({ discordUserId, body: text, severity }))) setBody("");
    });
  }

  // Confirm FIRST, transition SECOND. Awaited inside startTransition's async
  // scope the dialog's mount is deferred behind a transition that is itself
  // waiting on the dialog, and nothing ever resolves — the same trap
  // ActionBar.js documents.
  async function remove(id) {
    if (!(await confirm({ confirmLabel: "Delete" }))) return;
    startTransition(async () => {
      apply(await deleteAdminNote({ id }));
    });
  }

  return (
    <section className="panel flex flex-col gap-3 p-4">
      <h2 className="panel-header">Admin notes</h2>
      <p className="text-sm text-muted">Set moderation-related notes on a player.</p>

      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <label className="field">
        <textarea
          aria-label="Note"
          rows={3}
          maxLength={ADMIN_NOTE_MAX_LENGTH}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* One value out of three, so a segmented control rather than a chip
            row — the distinction DESIGN-SYSTEM.md draws between them. */}
        <div className="segmented" role="group" aria-label="Severity">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={level === severity}
              onClick={() => setSeverity(level)}
            >
              {ADMIN_NOTE_SEVERITY[level].label}
            </button>
          ))}
        </div>
        <button type="button" className="btn" disabled={pending || !body.trim()} onClick={submit}>
          Add
        </button>
      </div>

      <div className="admin-note-list">
        {state.notes.map((n) => (
          <article key={n.id} className="admin-note">
            <div className="admin-note-meta">
              <EnumPill map={ADMIN_NOTE_SEVERITY} value={n.severity} />
              <span>{n.author}</span>
              <span className="mono">{noteDate(n.createdAt)}</span>
              <button
                type="button"
                className="btn-quiet admin-note-delete"
                disabled={pending}
                onClick={() => remove(n.id)}
              >
                Delete
              </button>
            </div>
            <p className="admin-note-body">{n.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
