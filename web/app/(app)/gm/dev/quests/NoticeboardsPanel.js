"use client";

// Every noticeboard in the game on one page.
//
// There is nothing new here mechanically, and that is deliberate: pinning,
// reading and tearing are gmPostNotice / gmReadNotice / gmTearNotice in
// web/app/(app)/chat/actions.js, the same four verbs the board dialog in Chat
// and the panel in Discord already call. What was missing was ever seeing all
// the boards at once — from Chat you can only read the board you are standing
// at, which is right for a character and useless for advertising a quest in
// four places before supper.
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import EmptyState from "@/app/components/EmptyState";
import PaperSheet from "@/app/components/PaperSheet";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { gmReadNotice, gmTearNotice, gmPostNotice } from "@/app/(app)/chat/actions";

function Board({ board, onChanged }) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [reading, setReading] = useState(null);
  const [posting, setPosting] = useState(null);

  const placeKey = `loc:${board.locationId}`;

  const read = useCallback(
    (postId) => {
      setError(null);
      startTransition(async () => {
        const res = await gmReadNotice(placeKey, postId);
        if (res?.error) setError(res.error);
        else setReading(res);
      });
    },
    [placeKey],
  );

  // Confirm first, transition second (DESIGN-SYSTEM.md §8).
  async function tear(post) {
    const ok = await confirm({
      title: `Tear down ${post.name}?`,
      message: "The paper goes with it. There is no undo.",
      confirmLabel: "Tear it down",
      cancelLabel: "Leave it",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await gmTearNotice(placeKey, post.id);
      if (res?.error) setError(res.error);
      else onChanged();
    });
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>{board.locationName}</span>
        <span className="chip mono">{board.notices.length}</span>
      </div>

      {board.notices.length === 0 ? (
        <EmptyState>Nothing pinned here.</EmptyState>
      ) : (
        <table className="data-table">
          <tbody>
            {board.notices.map((n) => (
              <tr key={n.id}>
                <td>{n.name}</td>
                <td className="text-right">
                  <button type="button" className="btn-quiet" disabled={pending} onClick={() => read(n.id)}>
                    Read
                  </button>
                  <button type="button" className="btn-quiet" disabled={pending} onClick={() => tear(n)}>
                    Tear down
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <FormError>{error}</FormError>

      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={() => setPosting({ title: "", body: "" })}>
          Pin something
        </button>
      </div>

      {reading ? (
        <Modal open title={reading.name} onClose={() => setReading(null)}>
          {/* A GM is never stopped by readBlock — the board's own rule, not a
              new one (PAPERWORK.md). */}
          <PaperSheet paper={reading.paper} />
        </Modal>
      ) : null}

      {posting ? (
        <Modal open title={`Pin a notice in ${board.locationName}`} onClose={() => setPosting(null)}>
          <div className="field">
            <label className="field-label" htmlFor={`notice-title-${board.locationId}`}>
              Title
            </label>
            <input
              id={`notice-title-${board.locationId}`}
              type="text"
              value={posting.title}
              onChange={(e) => setPosting({ ...posting, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`notice-body-${board.locationId}`}>
              What it says
            </label>
            <textarea
              id={`notice-body-${board.locationId}`}
              rows={6}
              value={posting.body}
              onChange={(e) => setPosting({ ...posting, body: e.target.value })}
            />
          </div>
          <FormError>{error}</FormError>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              disabled={pending || !posting.body.trim()}
              onClick={() => {
                const input = { ...posting };
                setError(null);
                startTransition(async () => {
                  const res = await gmPostNotice(placeKey, input);
                  if (res?.error) {
                    setError(res.error);
                    return;
                  }
                  setPosting(null);
                  onChanged();
                });
              }}
            >
              Pin it
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default function NoticeboardsPanel({ boards }) {
  const router = useRouter();

  // A change re-reads the page rather than patching a row in local state.
  // Mirroring the prop into useState and syncing it back with an effect is
  // what react-hooks/set-state-in-effect exists to stop, and the server is
  // already the thing that knows what is pinned where.
  const refresh = useCallback(() => router.refresh(), [router]);

  if (boards.length === 0) {
    return <EmptyState>No Location in the game has a noticeboard.</EmptyState>;
  }

  return (
    <div className="quest-board-grid">
      {boards.map((board) => (
        <Board key={board.locationId} board={board} onChanged={refresh} />
      ))}
    </div>
  );
}
