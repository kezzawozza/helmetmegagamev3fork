"use client";

import { useEffect } from "react";
import { roundTrip, writeSnapshot } from "./snapshotStore";

// The fresh, serialisable props, written into the store (and localStorage) as soon as they arrive;
// SnapshotPage re-renders off the store, so this draws nothing. Round-tripped through JSON first so
// a server Date matches the snapshot's string shape. A module-store write in an effect is fine under
// react-hooks/set-state-in-effect; a setState there is not.
export default function SnapshotFresh({ scope, userId, data }) {
  useEffect(() => {
    writeSnapshot(scope, userId, roundTrip(data));
  }, [scope, userId, data]);
  return null;
}
