// Shared `.desk-header` for the (desk) route group — /gm/turns, /gm/audit, /gm/players — one tool, three faces
// (ADJUDICATION.md / DESIGN-SYSTEM.md §6's "desk" exception to PageShell). Not "use client": works from either a server or client parent.
export default function DeskHeader({ title, meta, actions }) {
  return (
    <header className="desk-header">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="section-title">{title}</h1>
        {meta}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

// The desks' turn chip, in one place so it cannot drift again. Always renders, including with no turn open
// ("No turn open" is a fact a GM needs). Not the same shape as AppHeader's TurnMeta: that answers "where/when" for
// a player (zone + game DAY); a desk works in TURNS, which every row/filter/push on it is keyed to.
export function DeskTurnChip({ turn }) {
  return (
    <span className="chip">
      {turn ? `Turn ${turn.number} · Day ${turn.dayNumber}` : "No turn open"}
    </span>
  );
}
