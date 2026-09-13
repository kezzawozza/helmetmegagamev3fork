import Link from "next/link";

import { SECTION_TIER, allows } from "@/lib/devAccess";
import { DEV_ELSEWHERE } from "@/lib/devNav";

// The Dev Panel's section rail — a plain server component, no "use client"
// and no usePathname: the active section comes from ?s=, already known by
// the page that renders this, not from the URL pathname (which never
// changes — every section is the same route).
//
// Which items a viewer sees comes from SECTION_TIER in web/lib/devAccess.js,
// the same table the page and every server action check against, so the rail
// cannot show a door the gate will not open.
const SECTIONS = [
  {
    title: "Game",
    items: [
      { key: "game", label: "Game" },
      { key: "games", label: "Games" },
      { key: "turn", label: "Turn" },
      { key: "config", label: "Configuration" },
      { key: "depot", label: "The Depot" },
      { key: "oracle", label: "The Oracle" },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "bulk", label: "Bulk actions" },
      { key: "letters", label: "Send a letter" },
      { key: "ambient", label: "Say something" },
      { key: "reports", label: "System reports" },
      { key: "gamemasters", label: "Gamemasters" },
    ],
  },
  {
    title: "Content",
    items: [{ key: "quests", label: "Quests" }],
  },
  {
    title: "Threats",
    items: [
      { key: "assignments", label: "Assignments" },
      { key: "antagonists", label: "Antagonists" },
    ],
  },
];

export default function OpsNav({ section, tier }) {
  const groups = SECTIONS.map((group) => ({
    ...group,
    items: group.items.filter((item) => allows(tier, SECTION_TIER[item.key])),
  })).filter((group) => group.items.length > 0);

  return (
    <nav className="ops-nav">
      {groups.map((group) => (
        <div key={group.title} className="ops-nav-group">
          <span className="ops-nav-title">{group.title}</span>
          {group.items.map((item) => (
            <Link
              key={item.key}
              href={`/gm/dev?s=${item.key}`}
              className="ops-nav-item"
              data-active={section === item.key ? "true" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}

      <div className="ops-nav-group">
        <span className="ops-nav-title">Elsewhere</span>
        {DEV_ELSEWHERE.map((item) => (
          <Link key={item.href} href={item.href} className="ops-nav-item ops-nav-item--away">
            {item.label} ↗
          </Link>
        ))}
      </div>

      {allows(tier, SECTION_TIER.danger) ? (
        <div className="ops-nav-group">
          <span className="ops-nav-title">Danger</span>
          <Link
            href="/gm/dev?s=danger"
            className="ops-nav-item"
            data-active={section === "danger" ? "true" : undefined}
          >
            Archive &amp; restart
          </Link>
        </div>
      ) : null}
    </nav>
  );
}
