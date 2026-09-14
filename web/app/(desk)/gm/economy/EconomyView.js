"use client";

import { Pulse } from "./sections/Pulse";
import { Ledger } from "./sections/Ledger";
import { Accounts } from "./sections/Accounts";
import { Health } from "./sections/Health";
import { Flows } from "./sections/Flows";
import { Faucets } from "./sections/Faucets";
import { Sinks } from "./sections/Sinks";
import { Goods } from "./sections/Goods";
import { Depot } from "./sections/Depot";
import { Factions } from "./sections/Factions";
import { NotBuilt, EmptyGame } from "./sections/shared";

// The economy desk's whole client half. One switch on `section`, dispatching
// to each section in ./sections/ (see sections/shared.js for shared pieces).
// Rendered by SnapshotPage (page.js): every prop is the DTO FreshEconomy
// built server-side, already redacted and zone-scoped. Nothing here talks to Prisma.
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
    case "flows":
      return <Flows {...props} />;
    case "faucets":
      return <Faucets {...props} />;
    case "sinks":
      return <Sinks {...props} />;
    case "goods":
      return <Goods {...props} />;
    case "depot":
      return <Depot {...props} />;
    case "factions":
      return <Factions {...props} />;
    default:
      return <NotBuilt section={props.section} />;
  }
}
