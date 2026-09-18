// Pure turn-formatting helpers, kept separate from turn.js's getOpenTurn() so client components can import these without dragging the @lifeweb/db (Prisma) barrel into the bundle.
export { turnsLeft, formatTurnsLeft, tagDuration, expiryFrom, expiryFor } from "@lifeweb/db/lib/turnFormat";

// How long is left to file a Move; counts to the CUTOFF (the adjudication window before the turn's end), not the end itself.
export function untilLabel(closesAt, now) {
  if (!closesAt) return null;
  const ms = new Date(closesAt).getTime() - now;
  if (ms <= 0) return "locked";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `closes in ${hours} h`;
  return `closes in ${Math.max(1, Math.round(ms / 60_000))} m`;
}

// "2h 14m" / "14m" for the LockChip; mirrors /gm/turns' own formatCountdown so both round the same way.
export function lockCountdown(ms) {
  if (ms == null || ms <= 0) return null;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// The day comes off Turn.dayNumber, stamped when the turn opened. It used to be ceil(number / 2), back when a turn was half
// a day; a turn is 6, 8, 12 or 24 hours now, so deriving it would renumber the past whenever a GM changed the length.
export function describeTurn(turn) {
  if (!turn) return { day: null, label: "NO TURN OPEN" };
  const day = turn.dayNumber ?? Math.ceil(turn.number / 2);
  return { day, label: `DAY ${day}` };
}

export function formatTurnLabel(turnNumber) {
  if (turnNumber == null) return "-";
  return `Turn ${turnNumber}`;
}
