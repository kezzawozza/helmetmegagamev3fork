// Shared, tiny geometry helpers for the chart components in this folder.
// Not part of the public barrel (index.js) -- internal to charts/ only.
//
// The one job every helper here does: never hand a NaN or Infinity to an SVG
// `d`/`x`/`y` attribute. A NaN in path data draws nothing and gives no error,
// which is the hardest kind of bug to spot in a GM's browser -- so every
// number that reaches JSX is passed through `num()` first.

// Coerce to a finite number, falling back to 0. Use at every read of
// caller-supplied data (a point's x/y, a link's value, a node's throughput).
export function num(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Linear scale: maps a value from [domainMin, domainMax] to [rangeMin, rangeMax].
// Degenerate domain (min === max, or a zero-width/empty series) collapses to
// the midpoint of the range rather than dividing by zero.
export function scale(value, domainMin, domainMax, rangeMin, rangeMax) {
  const v = num(value);
  const lo = num(domainMin);
  const hi = num(domainMax);
  if (hi - lo === 0) return (num(rangeMin) + num(rangeMax)) / 2;
  const t = (v - lo) / (hi - lo);
  return num(rangeMin) + t * (num(rangeMax) - num(rangeMin));
}

// Compact number formatting for axis ticks / labels: 1,284 / 12.9K / 4.2M.
export function compactNumber(value) {
  const n = num(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

// The eight validated categorical series tokens, in fixed order. Never
// generate a 9th -- fold extra series into "Other" at the call site.
const SERIES_VARS = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
  "var(--chart-series-5)",
  "var(--chart-series-6)",
  "var(--chart-series-7)",
  "var(--chart-series-8)",
];

export function seriesColor(index) {
  return SERIES_VARS[index % SERIES_VARS.length];
}
