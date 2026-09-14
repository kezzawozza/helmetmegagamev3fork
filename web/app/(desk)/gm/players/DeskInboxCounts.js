"use client";

import { useEffect, useMemo } from "react";
import { mergeRailRows, useRailPatches, useReadOverrides, reconcileReadOverrides } from "./liveInbox";
import { countInbox } from "./railCounts";
import { setNavUnread } from "@/app/components/navBadge";

// The header's "N unread · N awaiting" chips, counted over the same
// live-merged rows the rail shows. Also the one place that knows the desk's
// real unread number, so it publishes it to the nav rail's Players badge (navBadge.js).
export default function DeskInboxCounts({ rows, rowsAsOfMs }) {
  const patches = useRailPatches();
  const readOverrides = useReadOverrides();
  const merged = useMemo(
    () => mergeRailRows(rows, patches, rowsAsOfMs, readOverrides),
    [rows, patches, rowsAsOfMs, readOverrides],
  );
  const { unread, awaiting } = useMemo(() => countInbox(merged), [merged]);

  // Retiring an override is a store write, so it happens after the render that used it.
  useEffect(() => {
    reconcileReadOverrides(rows, rowsAsOfMs);
  }, [rows, rowsAsOfMs]);

  // Withdrawn on unmount so the rail goes back to the server's number elsewhere.
  useEffect(() => {
    setNavUnread(unread);
    return () => setNavUnread(null);
  }, [unread]);

  // One muted run, not two chips — the header's chips are reserved for the turn and the lock.
  if (unread === 0 && awaiting === 0) return null;
  return (
    <span className="text-xs text-muted">
      {[unread > 0 ? `${unread} unread` : null, awaiting > 0 ? `${awaiting} awaiting` : null]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}
