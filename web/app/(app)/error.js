"use client";

// Catches anything thrown while rendering a page under (app), keeping the nav rail alive so a player can walk away
// from a broken route instead of hitting back. Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function AppError({ error, retry }) {
  return <ErrorPanel error={error} retry={retry} />;
}
