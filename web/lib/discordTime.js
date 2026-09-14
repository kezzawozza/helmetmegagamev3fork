// Discord's seven timestamp styles, formatted for the web. Pure, so it can be exercised straight
// from node. Sits beside dmTime.js (the DM thread's own house style) rather than inside it: these are Discord's styles, not ours to choose.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const STYLE_OPTIONS = {
  t: { hour: "2-digit", minute: "2-digit" },
  T: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  d: { day: "2-digit", month: "2-digit", year: "numeric" },
  D: { day: "numeric", month: "long", year: "numeric" },
  f: { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
  F: { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
};

const UNITS = [
  [YEAR, "year"],
  [MONTH, "month"],
  [DAY, "day"],
  [HOUR, "hour"],
  [MINUTE, "minute"],
];

// Largest unit that fits (Discord's rule); falls through to seconds so "now" has a word.
function relativeParts(ms, now) {
  const diff = ms - now;
  const size = Math.abs(diff);
  for (const [span, unit] of UNITS) {
    if (size >= span) return [Math.round(diff / span), unit];
  }
  return [Math.round(diff / SECOND), "second"];
}

// `timeZone` is passed ONLY on the pre-hydration pass, pinned to "UTC", so server and browser
// produce a byte-identical string; omitted afterwards, which makes the second pass local (DiscordTime.js).
export function formatDiscordTimestamp(ms, style = "f", { now = Date.now(), timeZone } = {}) {
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return null;
  const zone = timeZone ? { timeZone } : {};
  const iso = at.toISOString();
  const title = new Intl.DateTimeFormat(undefined, { ...STYLE_OPTIONS.F, ...zone }).format(at);

  if (style === "R") {
    const [value, unit] = relativeParts(ms, now);
    const text = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(value, unit);
    return { text, title, iso };
  }

  const options = STYLE_OPTIONS[style] ?? STYLE_OPTIONS.f;
  return { text: new Intl.DateTimeFormat(undefined, { ...options, ...zone }).format(at), title, iso };
}
