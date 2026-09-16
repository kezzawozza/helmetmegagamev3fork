"use client";

import { useCallback, useState } from "react";
import Modal from "@/app/components/Modal";
import ArchiveContext from "@/app/components/ArchiveContext";

// The Archive tab's way into the scene behind one row: ArchiveContext over the
// top of the page. The view itself lives in that component, because the OOC
// lens on /gm/turns draws the same thing in the middle of the desk — a modal
// is where this one is put, not what it is.
export default function ArchiveContextModal({ archiveEntryId, onClose }) {
  // The jump link is the modal's own furniture (its footer action), so it
  // needs the loaded payload that ArchiveContext fetches.
  const [jumpUrl, setJumpUrl] = useState(null);
  // Stable, because ArchiveContext keys its fetch on it.
  const onLoaded = useCallback((data) => setJumpUrl(data?.jumpUrl ?? null), []);

  return (
    <Modal
      modeless
      title="In context"
      width="wide"
      onClose={onClose}
      actions={
        jumpUrl ? (
          <a className="btn-quiet" href={jumpUrl} target="_blank" rel="noreferrer">
            Open in Discord ↗
          </a>
        ) : null
      }
    >
      <ArchiveContext
        archiveEntryId={archiveEntryId}
        maxHeight="65vh"
        onLoaded={onLoaded}
      />
    </Modal>
  );
}
