"use client";

import { useState } from "react";
import DecreeComposer from "./DecreeComposer";

// The desk-header door to the decree composer — the same shape /gm/players' Bulk
// message button has, and for the same reason: a verb that belongs to the whole
// desk rather than to any one row has nowhere else to live.
export default function DecreeButton({ zones }) {
  const [open, setOpen] = useState(false);
  if (!zones?.length) return null;
  return (
    <>
      <button type="button" className="btn-quiet" onClick={() => setOpen(true)}>
        Decree
      </button>
      {open && <DecreeComposer zones={zones} onClose={() => setOpen(false)} />}
    </>
  );
}
