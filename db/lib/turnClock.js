// When the open turn ends, and when Moves stop being accepted. Nothing stores an end time: turns advance at 0:00 America/Chicago
// (bot/src/events/ready.js's cron), so the end is derivable from `turn.startedAt` — deriving from *now* instead broke on a bot restart, posting a
// stale "ends X hours ago". Pure: no Prisma, no discord.js. Takes a Turn row and returns Dates.

const TIME_ZONE = "America/Chicago";

// Moves must be in this many hours before the turn ends, giving a GM a window to adjudicate.
const MOVE_LOCK_HOURS = 3;

const MOVE_LOCK_MS = MOVE_LOCK_HOURS * 60 * 60 * 1000;

// Must match bot/src/events/ready.js's cron.
const TURN_BOUNDARY_HOURS = [0];

// DST-safe local-time-in-a-zone -> UTC conversion using only the built-in Intl API. db/turnCalendar.js requires it from here so there is one copy.
function getTimeZoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date(utcMs))
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUTC - utcMs;
}

function zonedTimeToUtc(y, m, d, h, min, s, timeZone) {
  let utc = Date.UTC(y, m - 1, d, h, min, s);
  for (let i = 0; i < 2; i++) {
    utc = Date.UTC(y, m - 1, d, h, min, s) - getTimeZoneOffsetMs(utc, timeZone);
  }
  return utc;
}

function zonedParts(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = Number(p.value);
      return acc;
    }, {});
}

// The first 00:00 Chicago boundary strictly after `turn.startedAt` — so a GM-opened turn ends at the coming midnight, not a full 24 hours later.
function turnEndsAt(turn) {
  if (!turn?.startedAt) return null;
  const startedAt = new Date(turn.startedAt).getTime();
  const { year, month, day } = zonedParts(new Date(startedAt), TIME_ZONE);
  const candidates = [];
  for (const dayOffset of [0, 1]) {
    for (const hour of TURN_BOUNDARY_HOURS) {
      candidates.push(zonedTimeToUtc(year, month, day + dayOffset, hour, 0, 0, TIME_ZONE));
    }
  }
  const end = Math.min(...candidates.filter((t) => t > startedAt));
  return new Date(end);
}

function moveCutoffAt(turn) {
  const end = turnEndsAt(turn);
  return end ? new Date(end.getTime() - MOVE_LOCK_MS) : null;
}

// `hasLock` is false in two cases: clockFrozen (db/lib/gameState.js#clockFrozen — no real end time to count back from), or a turn shorter than
// MOVE_LOCK_HOURS (would lock the entire turn the moment it opened). `locked` is only true inside the cutoff-to-end window, so a turn that has
// outlived its derived end (the cron missed) reopens rather than staying locked forever.
function moveWindow(turn, { now = new Date(), clockFrozen = false } = {}) {
  const endsAt = turnEndsAt(turn);
  const cutoffAt = endsAt ? new Date(endsAt.getTime() - MOVE_LOCK_MS) : null;
  const longEnough = Boolean(endsAt) && endsAt.getTime() - new Date(turn.startedAt).getTime() > MOVE_LOCK_MS;
  const hasLock = longEnough && !clockFrozen;
  const locked = hasLock && now.getTime() >= cutoffAt.getTime() && now.getTime() < endsAt.getTime();
  return { endsAt, cutoffAt, locked, hasLock };
}

// "Are we standing in the lock window right now?", as a reason rather than a bare boolean.
// There is no lock EVENT to subscribe to, so the two things that must happen at the cutoff — the Oracle drafting its chronicle (db/lib/oracleCutoff.js) and every pending Gambit throwing its die (db/lib/gambitCutoff.js) — are per-minute polls sharing this one predicate. Pure, so both are testable without a database or a clock.
function cutoffReached(turn, { now = new Date(), clockFrozen = false } = {}) {
  if (!turn) return { at: false, reason: "no open turn" };

  const { locked, hasLock, cutoffAt } = moveWindow(turn, { now, clockFrozen });

  if (!hasLock) return { at: false, reason: "this turn never locks" };
  // `locked` is false on BOTH sides: before the cutoff, and again once the turn has outlived its derived end because an advance was missed.
  if (!locked) return { at: false, reason: now < cutoffAt ? "before the cutoff" : "past the turn's end" };

  return { at: true, reason: "at the cutoff" };
}

function epochSeconds(date) {
  return date ? Math.round(date.getTime() / 1000) : null;
}

module.exports = {
  MOVE_LOCK_HOURS,
  TURN_BOUNDARY_HOURS,
  turnEndsAt,
  moveCutoffAt,
  moveWindow,
  cutoffReached,
  epochSeconds,
};
