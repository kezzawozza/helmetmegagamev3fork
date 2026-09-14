// What a game is CALLED. Never "Game 13". Lives here, not inside `/archive`, since both the
// picker and the Dev Panel's Games section (DEV-PANEL.md §11c) name a game.
export function gameTitle(game) {
  if (game?.label) return game.label;
  const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (game?.startedAt && game?.endedAt) return `${fmt(game.startedAt)} – ${fmt(game.endedAt)}`;
  if (game?.startedAt) return `From ${fmt(game.startedAt)}`;
  if (game?.createdAt) return `Unplayed · opened ${fmt(game.createdAt)}`;
  return "Unplayed";
}

export function shortId(game) {
  return (game?.id ?? "").slice(0, 7);
}
