"use client";

import { useState } from "react";
import BulkComposer from "./BulkComposer";

// The desk-header door to the bulk composer, for a GM sitting in the Inbox
// lens — the roster tab's checkboxes/textarea remain a second, inline path.
export default function BulkMessageButton({ characters }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-quiet" onClick={() => setOpen(true)}>
        Bulk message
      </button>
      {open && <BulkComposer characters={characters} onClose={() => setOpen(false)} />}
    </>
  );
}
