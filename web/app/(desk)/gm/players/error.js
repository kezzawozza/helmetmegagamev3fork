"use client";

// The conversation column's own boundary, below (desk)/error.js's nav rail:
// keeps the rail and roster up, and Try again re-renders just this column.
// Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function PlayerDeskError({ error, retry }) {
  return (
    <main className="desk-main">
      <ErrorPanel error={error} retry={retry} />
    </main>
  );
}
