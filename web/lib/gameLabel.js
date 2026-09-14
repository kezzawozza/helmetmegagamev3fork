// What a game is CALLED. Never "Game 13" — a game is its id, and reads as its label or the dates it
// ran. Lives here, not inside `/archive`, because both the picker and the Dev Panel's Games section
// (DEV-PANEL.md §11c) name a game.

// A label if one was given, otherwise the dates it ran.
export function gameTitle(game) {
  if (game?.label) return game.label;
  const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (game?.startedAt && game?.endedAt) return `${fmt(game.startedAt)} – ${fmt(game.endedAt)}`;
  if (game?.startedAt) return `From ${fmt(game.startedAt)}`;
  // "Unplayed" alone reads the same on every abandoned lobby, so date-stamp it.
  if (game?.createdAt) return `Unplayed · opened ${fmt(game.createdAt)}`;
  return "Unplayed";
}

// First seven characters of the cuid, git-short-hash style — what a GM matches against an audit
// row, a packet key or a backup.
export function shortId(game) {
  return (game?.id ?? "").slice(0, 7);
}
