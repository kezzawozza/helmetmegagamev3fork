"use client";

import { useCallback, useEffect, useState } from "react";
import PaperSheet from "@/app/components/PaperSheet";
import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import useActionRunner from "@/app/components/useActionRunner";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { readBoard, readNotice, tearNotice } from "./actions";

// THE NOTICEBOARD, in the street rather than behind a button (db/lib/noticeboard.js).
// Pinned at the top of the Location's feed, above the scene. The Noticeboard dialog
// in the right column keeps its own job: pinning one of YOUR papers via its picker.
// Anyone standing here may read one or tear one down, including somebody else's.

// What a notice says once read: `plain` is the refusal (blind, illiterate, dark, sealed —
// deliberately the SAME text in every case so nobody watching learns which it was),
// otherwise the paper's words, drawn as a sheet. Both go through PaperSheet; `reading.paper`
// is the server's shape and flat `text`/`plain` is only a fallback for a stale tab.
export function NoticeText({ reading, showName = true }) {
  if (!reading?.ok) return null;
  const paper = reading.paper ?? { kind: null, text: reading.text, plain: Boolean(reading.plain) };
  return (
    <div className="field">
      {showName && <span className="field-label">{reading.name}</span>}
      <PaperSheet paper={paper} />
    </div>
  );
}

export default function NoticeCards({ version = 0, onChanged }) {
  const [board, setBoard] = useState(null);
  const [reading, setReading] = useState(null);
  const { run, pending, error } = useActionRunner();
  const confirm = useConfirm();

  const load = useCallback(() => {
    readBoard()
      .then((res) => setBoard(res?.ok ? res : null))
      .catch(() => setBoard(null));
  }, []);

  // Re-read on open and on every pin or tear — the right-column dialog pins to this same board.
  useEffect(() => {
    load();
  }, [load, version]);

  const notices = board?.notices ?? [];
  if (notices.length === 0) return null;

  return (
    <div className="chat-notices">
      {notices.map((notice) => (
        <div key={notice.id} className="chat-notice-card">
          <p className="chat-notice-card-title">{notice.name}</p>
          <div className="chat-buttons">
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={() => run(readNotice, notice.id, { onOk: setReading })}
            >
              Read
            </button>
            <button
              type="button"
              className="btn-quiet"
              disabled={pending}
              onClick={async () => {
                if (
                  !(await confirm({
                    title: "Take it down?",
                    message: `${notice.name} comes off the board. You're holding it now.`,
                    confirmLabel: "Tear it down",
                  }))
                ) {
                  return;
                }
                run(tearNotice, notice.id, {
                  // Whoever owns the version counter re-reads for everybody; else refresh self.
                  onOk: (res) => (onChanged ? onChanged(res) : load()),
                });
              }}
            >
              Tear
            </button>
          </div>
        </div>
      ))}

      <FormError>{error}</FormError>

      {/* Same reading as the Noticeboard dialog, in a modal — nobody is told it was read. */}
      {reading?.ok && (
        <Modal open title={reading.name} onClose={() => setReading(null)} width="default">
          <NoticeText reading={reading} showName={false} />
        </Modal>
      )}
    </div>
  );
}
