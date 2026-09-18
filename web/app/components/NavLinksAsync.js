"use client";

import { use } from "react";
import NavLinks from "./NavLinks";
import InboxChime from "./InboxChime";

// Reads a still-pending nav-items promise via use() inside AppBar's own
// Suspense boundary, so the bar's links can paint immediately while the GM
// session check and Mortus-tag lookup stream in behind them — the same
// shape NavRailAsync.js had for the old rail.
//
// InboxChime is mounted here rather than in NavLinks so it only exists once
// the real unread count has resolved — mounting it against AppBar's
// fallback (badge-less GM_NAV) would seed 0 and chime on every page load.
export default function NavLinksAsync({ itemsPromise }) {
  const items = use(itemsPromise);
  const unread = items.find((item) => item.href === "/gm/players")?.badge ?? 0;
  return (
    <>
      <NavLinks items={items} />
      <InboxChime count={unread} />
    </>
  );
}
