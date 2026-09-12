import Link from "next/link";

// The economy desk's section rail — a plain server component, same posture as
// gm/dev/OpsNav.js: no usePathname, because every section is the same route
// and the active one comes from ?s=, which the page already knows.
//
// All ten sections are built now — Goods, The Depot and Factions were the
// last three, moved up from the "Coming later" group they used to sit in.
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
    <nav className="ops-nav">
      <div className="ops-nav-group">
        <span className="ops-nav-title">Economy</span>
        {BUILT.map((item) => (
          <Link
            key={item.key}
            href={`/gm/economy?s=${item.key}`}
            className="ops-nav-item"
            data-active={section === item.key ? "true" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
