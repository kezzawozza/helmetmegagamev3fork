import DeskRail, { DeskRailGroup, DeskRailItem } from "@/app/components/DeskRail";

// The economy desk's section rail — a plain server component, same posture
// as gm/dev/OpsNav.js: no usePathname, the active one comes from ?s=.
const BUILT = [
  { key: "pulse", label: "Pulse" },
  { key: "ledger", label: "Ledger" },
  { key: "accounts", label: "Accounts" },
  { key: "health", label: "Health" },
  { key: "flows", label: "Flows" },
  { key: "faucets", label: "Faucets" },
  { key: "sinks", label: "Sinks" },
  { key: "goods", label: "Goods" },
  { key: "depot", label: "The Depot" },
  { key: "factions", label: "Factions" },
];

export default function EconomyNav({ section }) {
  return (
    <DeskRail variant="sections" as="nav" ariaLabel="Economy sections">
      <DeskRailGroup title="Economy" dense>
        {BUILT.map((item) => (
          <DeskRailItem key={item.key} href={`/gm/economy?s=${item.key}`} active={section === item.key}>
            {item.label}
          </DeskRailItem>
        ))}
      </DeskRailGroup>
    </DeskRail>
  );
}
