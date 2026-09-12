"use client";

import { Pulse } from "./sections/Pulse";
import { Ledger } from "./sections/Ledger";
import { Accounts } from "./sections/Accounts";
import { Health } from "./sections/Health";
import { NotBuilt, EmptyGame } from "./sections/shared";

// The economy desk's whole client half. One switch on `section`, dispatching
// to the four sections in ./sections/ — each section used to live inline
// here; see sections/shared.js for the pieces they still share.
//
// Rendered by SnapshotPage (see page.js): every prop here is the DTO
// FreshEconomy built server-side, already redacted and zone-scoped where
// that applies. Nothing here talks to Prisma.
export default function EconomyView(props) {
  if (props.empty) return <EmptyGame section={props.section} />;
  if (props.notBuilt) return <NotBuilt section={props.section} />;

  switch (props.section) {
    case "pulse":
      return <Pulse {...props} />;
    case "ledger":
      return <Ledger {...props} />;
    case "accounts":
      return <Accounts {...props} />;
    case "health":
      return <Health {...props} />;
    default:
      return <NotBuilt section={props.section} />;
  }
}
