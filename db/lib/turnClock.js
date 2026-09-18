// When the open turn ends, and when Moves stop being accepted. Pure: no Prisma, no discord.js. Takes a Turn row and returns Dates.
//
// TWO THINGS COME OFF THE TURN ROW, NOT OFF GameConfig, and that is the whole design here. A turn carries its own
// `turnLengthHours` and its own `endsAt`, both stamped when it opened. So a GM changing the length mid-game moves the NEXT
// turn and never the open one — nobody's deadline jumps while they are mid-action — and db/lib/oracleInput.js can ask a turn
// that closed last week what its cutoff was and get the right answer. Reading the live config here instead would also make
// every one of these functions async, which ~20 synchronous callers are not.
//
// Deriving from `turn.startedAt` rather than from *now* is the older half of the same rule: deriving from now broke on a bot
// restart, posting a stale "ends X hours ago".

const TIME_ZONE = "America/Chicago";

// The lengths a GM may pick, in hours. Each divides 24, which is what keeps the boundary grid landing on clean local times.
const TURN_LENGTH_CHOICES = [6, 8, 12, 24];
const DEFAULT_TURN_LENGTH_HOURS = 24;

// How long before the turn ends Moves stop being accepted, giving a GM a window to adjudicate what was filed. Hardcoded per
// length rather than a knob: it is a property of how much there is to read, and a GM who could set it to zero would be
// adjudicating a push that was still moving.
const ADJUDICATION_HOURS = { 6: 2, 8: 2, 12: 3, 24: 3 };

// The columns turnEndsAt/moveWindow read. A caller that selects only `startedAt` still gets an ANSWER — the fallback
// derivation fires — it is just the wrong one, silently, at 24 hours. Spread this into any partial select.
const TURN_CLOCK_SELECT = { startedAt: true, endsAt: true, turnLengthHours: true };

function normalizeTurnLength(hours) {
  return TURN_LENGTH_CHOICES.includes(Number(hours)) ? Number(hours) : DEFAULT_TURN_LENGTH_HOURS;
}

// The local hours a turn may end on: 6 -> [0, 6, 12, 18]. Replaces the old TURN_BOUNDARY_HOURS constant, which had to be kept
// in step by hand with a cron string that no longer exists — the bot polls `advanceDue` every minute now.
function boundaryHours(lengthHours) {
  const step = normalizeTurnLength(lengthHours);
  return Array.from({ length: 24 / step }, (_, i) => i * step);
}

function adjudicationHours(lengthHours) {
  return ADJUDICATION_HOURS[normalizeTurnLength(lengthHours)];
}

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

// The first Chicago grid boundary strictly after `ms`. A manual advance therefore SNAPS FORWARD rather than running a full
// length: end a 6-hour turn by hand at 15:00 and the next one runs to 18:00, three hours, not 21:00. Scanning today and
// tomorrow is enough for any length that divides 24, and DST is handled by zonedTimeToUtc rather than by arithmetic.
function nextBoundaryAfter(ms, lengthHours) {
  const { year, month, day } = zonedParts(new Date(ms), TIME_ZONE);
  const candidates = [];
  for (const dayOffset of [0, 1]) {
    for (const hour of boundaryHours(lengthHours)) {
      candidates.push(zonedTimeToUtc(year, month, day + dayOffset, hour, 0, 0, TIME_ZONE));
    }
  }
  return Math.min(...candidates.filter((t) => t > ms));
}

// The stored answer, with the derivation kept only for rows written before `endsAt` existed.
function turnEndsAt(turn) {
  if (!turn?.startedAt) return null;
  if (turn.endsAt) return new Date(turn.endsAt);
  return new Date(nextBoundaryAfter(new Date(turn.startedAt).getTime(), turn.turnLengthHours));
}

function turnLockMs(turn) {
  return adjudicationHours(turn?.turnLengthHours) * 60 * 60 * 1000;
}

function moveCutoffAt(turn) {
  const end = turnEndsAt(turn);
  return end ? new Date(end.getTime() - turnLockMs(turn)) : null;
}

// `hasLock` is false in two cases: clockFrozen (db/lib/gameState.js#clockFrozen — no real end time to count back from), or a
// turn shorter than its adjudication window (would lock the entire turn the moment it opened, which a manual advance a few
// minutes before a boundary produces). `locked` is only true inside the cutoff-to-end window, so a turn that has outlived its
// derived end (the poll missed) reopens rather than staying locked forever.
//
// NOTE that `locked: false` is NOT "the game is open" — a frozen clock reports false here, because freezing removes the
// deadline rather than shutting the game. Whether a player may act at all is db/lib/turnGate.js#movesOpen, which asks about
// the session first and this second.
function moveWindow(turn, { now = new Date(), clockFrozen = false } = {}) {
  const endsAt = turnEndsAt(turn);
  const lockMs = turnLockMs(turn);
  const cutoffAt = endsAt ? new Date(endsAt.getTime() - lockMs) : null;
  const longEnough = Boolean(endsAt) && endsAt.getTime() - new Date(turn.startedAt).getTime() > lockMs;
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

// "Should the turn have advanced by now?" — the bot's per-minute poll (bot/src/events/ready.js) asks this instead of a cron
// string, which is what lets the boundary grid be 6, 8, 12 or 24 hours wide and what makes a missed tick heal in a minute
// rather than at the next midnight. Pure, so it is testable without a clock.
function advanceDue(turn, { now = new Date() } = {}) {
  const endsAt = turnEndsAt(turn);
  return Boolean(endsAt) && now.getTime() >= endsAt.getTime();
}

// Which in-game day a turn opening at `startedAt` belongs to. The day rolls at 00:00 America/Chicago whatever the turn
// length is, so a 24-hour game gets one turn a day and a 6-hour game gets four — and a GM changing the length mid-game
// moves nothing that already happened, because every turn keeps the number it was given.
//
// `ceil(number / 2)` used to answer this and cannot any more: it would renumber the whole history the moment the length
// changed, including the day keys the Bird and Fast Travel claim once a day against (Character.birdTurnId).
function nextDayNumber(lastTurn, startedAt) {
  if (!lastTurn) return 1;
  const previous = lastTurn.startedAt ? zonedParts(new Date(lastTurn.startedAt), TIME_ZONE) : null;
  const current = zonedParts(startedAt, TIME_ZONE);
  const sameDay =
    previous &&
    previous.year === current.year &&
    previous.month === current.month &&
    previous.day === current.day;
  return (lastTurn.dayNumber ?? 1) + (sameDay ? 0 : 1);
}

// Whether the sun is up in Ravenheart, on the real Chicago clock. Sun Sensitivity used to ask whether the open turn was a
// DAWN one; with no phases left, "is it daytime" has to be answered by the actual time of day. 06:00-18:00 was also,
// until 2026-09-18, the window the app's own look ran on (web/lib/clockTheme.js, since deleted — the app now wears one
// look at all hours); this game mechanic is independent of that and keeps its own constants below.
const DAYLIGHT_START_HOUR = 6;
const DAYLIGHT_END_HOUR = 18;

function isDaylight(now = new Date()) {
  const { hour } = zonedParts(now, TIME_ZONE);
  return hour >= DAYLIGHT_START_HOUR && hour < DAYLIGHT_END_HOUR;
}

function epochSeconds(date) {
  return date ? Math.round(date.getTime() / 1000) : null;
}

module.exports = {
  TIME_ZONE,
  TURN_LENGTH_CHOICES,
  TURN_CLOCK_SELECT,
  DEFAULT_TURN_LENGTH_HOURS,
  normalizeTurnLength,
  boundaryHours,
  adjudicationHours,
  nextBoundaryAfter,
  zonedTimeToUtc,
  zonedParts,
  turnEndsAt,
  moveCutoffAt,
  moveWindow,
  cutoffReached,
  advanceDue,
  nextDayNumber,
  DAYLIGHT_START_HOUR,
  DAYLIGHT_END_HOUR,
  isDaylight,
  epochSeconds,
};
