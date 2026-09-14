"use client";

import { useState } from "react";
import { useSnapshot } from "./snapshotStore";

// The shell a snapshotted page renders (docs/systemdocs/CHAT.md §5c): draws `fallback` until fresh
// data lands, then `render`; remounts once per mount so a stale prop copy isn't kept. Once painted, it never paints `fallback` over the view again.
export default function SnapshotPage({
  scope,
  userId,
  render: View,
  fallback = null,
  remountOnFresh = true,
  children,
}) {
  const data = useSnapshot(scope, userId);
  const [first] = useState(data);
  // set during render, not in an effect (react-hooks/set-state-in-effect)
  const [held, setHeld] = useState(data);
  if (data !== null && data !== held) setHeld(data);
  const shown = data ?? held;
  const stale = remountOnFresh && first !== null && shown === first;
  return (
    <>
      {shown ? <View key={stale ? "stored" : "fresh"} {...shown} /> : fallback}
      {children}
    </>
  );
}
