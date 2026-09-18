// Which look the app wears, from the real clock in Chicago — not from the
// turn's phase (REDESIGN.md §4). A DAWN turn runs midnight to midnight
// (TURN-ENGINE.md §1), so the old themeForPhase made the whole app read "dawn"
// for a full real day and "dusk" for the next one. This is time of day
// instead: lamps up through the working hours, banked overnight.
//
// Pure and dependency-free on purpose — the server calls it in
// web/app/layout.js, the client calls it in LampTick.js, and
// web/lib/__tests__/clockTheme.test.mjs calls it under `node --test`. It must
// stay free of Prisma, React and `window`.

export const THEME_TIME_ZONE = "America/Chicago";

// The two named looks. Was in turnFormat.js next to themeForPhase, which this
// module replaces; BASCINET_THEME is still matched against this list.
export const THEMES = ["dusk", "dawn"];

// Local Chicago hours. Dawn look from 06:00, dusk look from 18:00.
export const DAWN_HOUR = 6;
export const DUSK_HOUR = 18;

// How far toward the dusk values the daytime gradient is allowed to travel.
// NOT 1: if the ramp arrived at dusk by 17:59 the hard switch at 18:00 would
// be invisible. At 0.6 the step is still there, and it is larger than the
// remaining 0.4 because the dusk block also swaps the nine tokens the ramp
// does not touch (--muted, --accent-text, --field-bg, the bevel pair,
// --row-hover, --shadow-color, --blackletter, --zone-fortress, --map-river).
export const LAMP_MAX = 0.6;

// The coarse timer (REDESIGN.md §9: no per-frame anything). Five minutes moves
// --lamp by 0.004 of the ramp, which is under a quantisation step on every
// token in it — the gradient is invisible in motion and only obvious if you
// come back hours later, which is the intent.
export const LAMP_TICK_MS = 5 * 60 * 1000;

// Minutes since local midnight in Chicago. Intl carries the DST rules, so this
// is right on both sides of the March and November boundaries and needs no
// dependency; db/lib/turnClock.js does its own zone math the same way.
// hourCycle "h23" is load-bearing: `hour12: false` reports midnight as "24"
// in some ICU builds, and the `% 24` is a second belt for that.
export function chicagoMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: THEME_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const read = (type) => Number(parts.find((p) => p.type === type).value);
  return (read("hour") % 24) * 60 + read("minute");
}

// Three decimals, so the server's inline style string and the client's later
// writes are the same shape and neither churns the attribute pointlessly.
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// The look for an instant. `lamp` is 0 at dawn, LAMP_MAX just before dusk, and
// 1 all night — the dusk block ignores it, but 1 keeps the value honest.
export function lookAt(date = new Date()) {
  const minutes = chicagoMinutes(date);
  const start = DAWN_HOUR * 60;
  const end = DUSK_HOUR * 60;
  if (minutes < start || minutes >= end) return { theme: "dusk", lamp: 1 };
  return { theme: "dawn", lamp: round3(((minutes - start) / (end - start)) * LAMP_MAX) };
}

// BASCINET_THEME pins the environment to one look with no gradient: lamp goes
// to the end of the ramp that matches the pinned block, and LampTick.js skips
// its timer entirely. Anything unrecognised (including the deleted
// "limestone") falls through to the clock.
export function resolveLook(override, date = new Date()) {
  if (THEMES.includes(override)) {
    return { theme: override, lamp: override === "dusk" ? 1 : 0, pinned: true };
  }
  return { ...lookAt(date), pinned: false };
}
