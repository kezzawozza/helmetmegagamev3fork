const { moveWindow, epochSeconds } = require("./lib/turnClock");

// A turn runs 6, 8, 12 or 24 hours (GameConfig.turnLengthHours) and ends on a
// clean America/Chicago boundary. There are no Dawn and Dusk halves any more —
// a turn is a turn, and Turn.dayNumber says which in-game day it belongs to.
// The announcement renders the deadlines as Discord <t:EPOCH:t>/<t:EPOCH:R>
// tags, which needs an actual Unix epoch rather than a text label. Those tags
// are the one place a reader sees their OWN timezone rather than the game's:
// Discord renders them client-side and the bot cannot override it.
//
// The derivation (and the DST-safe local-time-in-a-zone -> UTC conversion it
// needs) lives in db/lib/turnClock.js, which works off the turn's own stored
// endsAt rather than off `now` — see the note there for why that matters.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The in-fiction calendar. Day 1 is April 21st, 1098, and it turns over once
// per in-game day — so every turn sharing a Turn.dayNumber shares a date. This
// has nothing to do with db/lib/turnClock.js: that module owns the real clock
// the deadlines run on, and this one is a label. UTC getters throughout so no timezone or DST
// can shift the day, and the month name and ordinal are written out here
// rather than left to Intl, which would want a locale pinned and still not
// give us "21st".
const GAME_EPOCH = Date.UTC(1098, 3, 21);
const DAY_MS = 24 * 60 * 60 * 1000;

// The bare year, on its own, for the two places that used to hand-type
// "1098": the "Ravenheart …" foot line (PageShell.js, CharacterSheet.js) and
// the top bar's clock block ("Day 14 · 1098 · Turn 27 · 10:28 PM",
// TopBar/ClockBlock.js). One exported constant rather than a third literal —
// it reads off the same epoch gameDate() does, so if the game ever runs long
// enough to cross a year boundary, the day-of-year math would need to move
// here too rather than in a fourth copy.
const GAME_YEAR = new Date(GAME_EPOCH).getUTCFullYear();

function ordinal(n) {
  // 11th, 12th and 13th are the exceptions the last-digit rule gets wrong.
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function gameDate(day) {
  const d = new Date(GAME_EPOCH + (day - 1) * DAY_MS);
  return `${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}, ${d.getUTCFullYear()}`;
}

// Shared by the bot's cron-triggered turn advance and the GM dashboard's
// manual "End turn" action so the announcement text (and the ping logic behind
// it) only exists in one place instead of being duplicated
// per transport (Discord.js channel.send vs. REST postMessage).
function buildTurnAnnouncement(turn, note, { clockFrozen = false, frozenReason = null } = {}) {
  const day = turn.dayNumber ?? Math.ceil(turn.number / 2);
  const pingRoleId = process.env.DISCORD_TURN_PING_ROLE_ID;
  const ping = pingRoleId ? `<@&${pingRoleId}>` : "";
  const { endsAt, cutoffAt, hasLock } = moveWindow(turn, { clockFrozen });
  const endEpoch = epochSeconds(endsAt);
  const cutoffEpoch = epochSeconds(cutoffAt);
  // The Move cutoff rides on the turn announcement because that is the one
  // place every player reliably reads — and both times are <t:> tags, so each
  // reads them in their own timezone.
  //
  // Out of session there is no deadline at all, and saying so is more use than
  // a time nobody is counting down to (db/lib/session.js).
  const clock =
    frozenReason === "NOT_IN_SESSION"
      ? "The game isn't in session."
      : hasLock
        ? `This turn ends at <t:${endEpoch}:t>, or <t:${endEpoch}:R> | Moves must be sent by <t:${cutoffEpoch}:t>, or <t:${cutoffEpoch}:R>.`
        : `This turn ends at <t:${endEpoch}:t>, or <t:${endEpoch}:R>.`;
  // The bookkeeping rides in `-#` subtext so it does not compete with the line
  // players actually read. There used to be a one-word scene line above the
  // clock — "Dawn." or "Dusk." — and with the phases gone it has nothing left
  // to say, so the ping it carried moves onto the clock line rather than
  // sitting alone on a line of its own.
  const header = `-# Day ${day}, Turn ${turn.number} | ${gameDate(day)}`;
  const body = `${header}\n\n${ping ? `${ping}\n` : ""}${clock}`;
  return note ? `${body}\n\n${note}` : body;
}

module.exports = { gameDate, GAME_YEAR, buildTurnAnnouncement };
