// The Dev Panel's destinations, shared by both /gm/dev shells: the desk-shaped panel's rail
// (OpsNav.js) and the sub-pages' horizontal row (DevSubNav.js). `panel` is the Dev Panel itself —
// OpsNav drops it, DevSubNav keeps it as the way back.
export const DEV_PAGES = [
  { key: "panel", href: "/gm/dev", label: "Dev Panel" },
  { key: "characters", href: "/gm/dev/characters", label: "Characters" },
  { key: "factions", href: "/gm/dev/factions", label: "Factions" },
  { key: "tags", href: "/gm/dev/tags", label: "Tags" },
];

// What OpsNav's fourth group offers: everywhere but the panel you are on.
export const DEV_ELSEWHERE = DEV_PAGES.filter((p) => p.key !== "panel");
