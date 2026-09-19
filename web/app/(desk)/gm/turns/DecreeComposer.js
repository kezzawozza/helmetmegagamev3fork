"use client";

import { useMemo, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import CheckPicker from "@/app/components/CheckPicker";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { noteActionVersion, mutationErrorMessage } from "@/app/components/useDeskVersion";
import { DECREE_BODY_MAX, DECREE_TITLE_MAX } from "@lifeweb/db/lib/decreeText";
import { sendDecree } from "./actions";

// Writing a decree. The one door is `/decree` in the chat composer
// (web/app/(app)/chat/commands.js, opened through DecreeDialog.js — this
// component is unchanged by that move and still knows nothing about where
// it was opened from). There used to be a second door, a Decree button in
// this desk's own header; it was retired when Bascinet asked for the
// command instead, and this dialog is what it reused rather than a rewrite.
// What comes out is db/lib/decree.js — a blackletter notice block in every
// chosen zone's feed and an embed in its #summary.
//
// Two things this dialog does that the staged composers do not. It SENDS rather
// than stages, so it asks first (useConfirm) — there is no tray to take it back
// out of once the words are in the channel. And the caps it counts against are
// Discord's own embed limits, imported from db/lib/decreeText.js rather than
// written down again here, since the server validates against the same two
// numbers. That file has zero requires, which is what makes it safe to import
// from a "use client" module (the same rule chunkText.js follows).
//
// Not modeless: this is not a composer you read a Move beside, it is one
// question, and the answer goes out to everybody at once.
export default function DecreeComposer({ zones, onClose }) {
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Every zone, which is the shape a decree usually takes — the picker is for
  // the rarer one aimed at a single place.
  const [picked, setPicked] = useState(() => zones.map((z) => z.id));
  const [error, setError] = useState(null);
  const [sentNote, setSentNote] = useState(null);
  const [pending, startTransition] = useTransition();

  const items = useMemo(
    () =>
      zones.map((z) => ({
        id: z.id,
        label: z.name,
        // A cave level has no #summary channel and never did (CHANNELS.md §2),
        // so the words land in its Location channels instead. Worth saying
        // before the decree goes out, not after.
        note: z.kind === "CAVE_LEVEL" ? "no summary channel — posts in each Location" : null,
      })),
    [zones],
  );

  // No maxLength on either input: a paste that runs long stays whole and visible
  // so a GM can trim it, rather than being silently cut at the cap.
  const titleOver = title.trim().length > DECREE_TITLE_MAX;
  const bodyOver = body.trim().length > DECREE_BODY_MAX;
  const canSend = title.trim().length > 0 && body.trim().length > 0 && !titleOver && !bodyOver && picked.length > 0;

  async function submit() {
    if (!canSend || pending) return;
    setError(null);
    const where = picked.length === zones.length ? "every zone" : `${picked.length} zone${picked.length === 1 ? "" : "s"}`;
    const ok = await confirm({
      title: "Send this decree?",
      message: `Sent to ${where}. No taking it back.`,
      confirmLabel: "Send it",
    });
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = noteActionVersion(await sendDecree({ title: title.trim(), body: body.trim(), zoneIds: picked }));
        if (!res?.ok) {
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        // A zone whose channel bounced still has the row in its feed, so this is
        // a note rather than an error — and the dialog stays open carrying it,
        // because a GM who is told "nothing came through in the Yard" needs the
        // words still in front of them.
        if (res.failed?.length > 0) {
          setSentNote(`Sent. Discord did not take it in ${res.failed.join(", ")} — the feed has it either way.`);
          return;
        }
        onClose();
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  }

  return (
    <Modal title="Decree" onClose={() => !pending && onClose()} width="wide">
      <div className="flex flex-col gap-4 p-4">
        <label className="field">
          <span className="field-label">
            Title{" "}
            <span className={titleOver ? "text-danger" : "text-muted"}>
              ({title.trim().length}/{DECREE_TITLE_MAX})
            </span>
          </span>
          <input
            type="text"
            data-autofocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Notice title…"
          />
        </label>

        <label className="field">
          <span className="field-label">
            Decree{" "}
            <span className={bodyOver ? "text-danger" : "text-muted"}>
              ({body.trim().length}/{DECREE_BODY_MAX})
            </span>
          </span>
          <textarea
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write the decree here…"
          />
        </label>

        <CheckPicker
          label="Zones"
          items={items}
          value={picked}
          onChange={setPicked}
          emptyLabel="No zones."
          allLabel="Every zone"
          maxHeight="14rem"
        />

        <FormError>{error}</FormError>
        {sentNote ? <p className="text-xs text-muted">{sentNote}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onClose} disabled={pending}>
            {sentNote ? "Close" : "Cancel"}
          </button>
          {/* Shut once it has gone out, even on a partial send: the words are in
              the channels that took them, and pressing this again would proclaim
              the whole thing twice to reach one zone. Reopening the dialog is
              the way to send another. */}
          <button type="button" className="btn" onClick={submit} disabled={pending || !canSend || Boolean(sentNote)}>
            {pending ? "Sending…" : "Send decree"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
