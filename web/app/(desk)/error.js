"use client";

// Catches anything thrown rendering a desk page, so a bad render doesn't fall
// through to app/global-error.js and take the whole document with it.
// Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function DeskError({ error, retry }) {
  return <ErrorPanel error={error} retry={retry} />;
}
