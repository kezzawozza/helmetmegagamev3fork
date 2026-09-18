"use client";

import { use } from "react";
import NavLinks from "./NavLinks";

// Reads a still-pending nav-items promise via use() inside AppBar's own
// Suspense boundary, so the bar's links can paint immediately while the GM
// session check and Mortus-tag lookup stream in behind them — the same
// shape NavRailAsync.js had for the old rail.
export default function NavLinksAsync({ itemsPromise }) {
  const items = use(itemsPromise);
  return <NavLinks items={items} />;
}
