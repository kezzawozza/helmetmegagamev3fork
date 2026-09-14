"use client";

import { useLinkStatus } from "next/link";

// The click's receipt: with no route-level loading.js, the router holds the page until the next has loaded, so this fills that beat. `useLinkStatus` must run in a descendant of <Link>, hence its own component.
// ~120ms delay avoids flashing on fast loads; only opacity moves, so it can never shift the rail's layout.
export default function RailLinkPending() {
  const { pending } = useLinkStatus();
  return <span className="rail-item-pending" data-pending={pending ? "true" : "false"} aria-hidden="true" />;
}
