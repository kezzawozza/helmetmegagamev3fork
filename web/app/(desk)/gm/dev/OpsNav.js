import Link from "next/link";

import { SECTION_TIER, allows } from "@/lib/devAccess";

// The Dev Panel's section rail — a plain server component, no usePathname:
// the active section comes from ?s=. Which items a viewer sees comes from
// SECTION_TIER (web/lib/devAccess.js), the same table the page and every
// server action check, so the rail can't show a door the gate won't open.
const SECTIONS = [
  {
    title: "Game",
    items: [
      { key: "game", label: "Game" },
      // The key stays `games` — renaming it would break every bookmark for
      // nothing. "History" is what the section IS: every game there has been.
      { key: "games", label: "History" },
      { key: "turn", label: "Turn" },
      { key: "config", label: "Configuration" },
      { key: "depot", label: "Depot" },
      { key: "oracle", label: "Oracle" },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "bulk", label: "Bulk actions" },
      { key: "reports", label: "System reports" },
      { key: "gamemasters", label: "Gamemasters" },
    ],
  },
  {
    // The things the game is made of. Characters, Factions, Tags and Zones
    // used to be four pages of their own, linked from an "Elsewhere" group
    // that threw you out of the desk to reach them.
    title: "Content",
    items: [
      { key: "quests", label: "Quests" },
      { key: "characters", label: "Characters" },
      { key: "factions", label: "Factions" },
      { key: "tags", label: "Tags" },
      { key: "zones", label: "Zones" },
    ],
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
