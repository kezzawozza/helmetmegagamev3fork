"use client";

// Mirrors (app)/error.js: catches anything thrown rendering a page in this group, so /handbook — the one route
// here meant to survive a link shared with someone who has never opened the app before — doesn't fall through to
// Next's raw digest screen. Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function PublicError({ error, retry }) {
  return <ErrorPanel error={error} retry={retry} />;
}
