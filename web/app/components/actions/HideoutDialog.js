"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useActionPools } from "./poolsContext";
import { setHideout } from "@/app/(app)/character/thanatiActions";

// Set Hideout (leader only): a room at your Location you can get into, as
// chips, the current one marked. THANATI.md §3.
export default function HideoutDialog({ mode, onDone, onClose }) {
  const pools = useActionPools();
  const rooms = pools.hideoutRooms ?? [];
  const [roomId, setRoomId] = useState("");
  const { submit, busy, error } = useSubmit();

  return (
    <ActionDialog
      title="Set hideout"
      busy={busy}
      error={error}
      empty={rooms.length === 0 ? "There’s no room here you could use." : null}
      canSubmit={Boolean(roomId)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => setHideout({ roomId }),
          (res) => onDone(noticeLine(mode, res)),
        )
      }
    >
      <ChipPicker
        label="Room"
        options={rooms.map((r) => ({ id: r.id, label: r.name, note: r.current ? "✓ current" : null }))}
        value={roomId}
        onChange={setRoomId}
      />
    </ActionDialog>
  );
}
