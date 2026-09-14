"use client";

import { useEffect } from "react";
import { clearSnapshots } from "./snapshotStore";

// Mounted by the public layout: no account here means every stored snapshot is somebody's
// old sheet on a shared machine, so it goes.
export default function SnapshotGuard({ userId }) {
  useEffect(() => {
    if (!userId) clearSnapshots();
  }, [userId]);
  return null;
}
