"use client";

import { noteActionVersion } from "@/app/components/useDeskVersion";

import { useMemo, useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import Modal from "@/app/components/Modal";
import CheckPicker from "@/app/components/CheckPicker";
import usePickList from "@/app/components/usePickList";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import { scoreMatch } from "@/lib/fuzzySearch";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { sendGmBroadcast } from "./actions";

// Bulk message composer — the one bulk-message UI, reached through three doors
// (the roster's Message selected, the header's Bulk message, the inspector's
// Message pinned). `initialSelectedIds` is how the pinned shortcut opens it
// already pointed at somebody; the picker stays fully editable afterwards.
//
// The roster itself is the shared CheckPicker the Dev Panel's bulk section
// uses, so "tick some characters" looks and behaves the same on both desks.
// What stays here is what is actually about messaging: the character cap, the
// two one-shot segment selects, and the send.
const searchRoster = (item, query) =>
  scoreMatch(query, { name: item.label, role: item.roleTitle, zone: item.zoneName });

export default function BulkComposer({ characters, initialSelectedIds, onClose }) {
  const [refresh] = useRefresh();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // The picker's row shape: the name, the place under it, and the fields
  // searchRoster reads.
  const items = useMemo(
    () =>
      characters.map((c) => ({
        id: c.id,
        label: c.name,
        note: [c.roleTitle, c.zoneName].filter(Boolean).join(" · "),
        roleTitle: c.roleTitle,
        zoneName: c.zoneName,
      })),
    [characters],
  );

  const pick = usePickList(items, initialSelectedIds ?? []);

  const zoneOptions = useMemo(
    () => [...new Set(characters.map((c) => c.zoneName).filter(Boolean))].sort(),
    [characters],
  );

  const over = message.length > GM_MESSAGE_MAX_LENGTH;
  const canSend = pick.count > 0 && message.trim().length > 0 && !over;

  function submit() {
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      const res = noteActionVersion(
        await sendGmBroadcast({ characterIds: [...pick.picked], message: message.trim() }),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      refresh();
      onClose();
    });
  }

  return (
    <Modal title="Message multiple players" onClose={() => !pending && onClose()} width="wide">
      <div className="flex flex-col gap-3 p-4">
        <CheckPicker
          items={items}
          value={pick.picked}
          onChange={pick.set}
          search={searchRoster}
          filterPlaceholder="Name, role, zone…"
          emptyLabel="No characters match."
          maxHeight="16rem"
          toolbar={
            <>
              {zoneOptions.length > 0 && (
                <label className="field">
                  <span className="field-label">Check zone</span>
                  <Select value="" onChange={(e) => pick.checkWhere((c) => c.zoneName === e.target.value)}>
                    <option value="">Pick a zone…</option>
                    {zoneOptions.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </>
          }
        />

        <label className="field">
          <span className="field-label">
            Message ({pick.count} recipient{pick.count === 1 ? "" : "s"}, sent from Bascinet)
          </span>
          <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={over ? { color: "var(--danger)" } : { color: "var(--muted)" }}>
            {message.length} / {GM_MESSAGE_MAX_LENGTH}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-quiet" disabled={pending} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" disabled={pending || !canSend} onClick={submit}>
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}
