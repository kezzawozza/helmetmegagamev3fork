// Pure turn-formatting helpers, kept separate from turn.js's getOpenTurn() so client components can import these without dragging the @lifeweb/db (Prisma) barrel into the bundle.
export { turnsLeft, formatTurnsLeft, tagDuration, expiryFrom, expiryFor } from "@lifeweb/db/lib/turnFormat";

// How long is left to file a Move; counts to the CUTOFF (MOVE_LOCK_HOURS before midnight), not the turn's end.
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

export function describeTurn(turn) {
  if (!turn) return { day: null, phase: null, label: "NO TURN OPEN" };
  const day = Math.ceil(turn.number / 2);
  return { day, phase: turn.phase, label: `DAY ${day} · ${turn.phase}` };
}

export function formatTurnLabel(turnNumber, phase) {
  if (turnNumber == null) return "-";
  if (!phase) return `Turn ${turnNumber}`;
  const phaseLabel = phase.charAt(0) + phase.slice(1).toLowerCase();
  return `Turn ${turnNumber}, ${phaseLabel}`;
}
