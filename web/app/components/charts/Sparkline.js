import { num, scale } from "./chartUtils";

// Server component: a sparkline is meant to be dropped into a table cell by
// the dozen (one per row on a data-heavy desk), so it must stay static and
// cheap -- no hover state, no client bundle cost. `Sparkline.js` has no "use
// client" for that reason. A viewer who wants the exact values reads the
// aria-label or the row's own numeric column; a per-row hover layer here
// would be real cost for a chart the size of a word.
//
// `points` is an array of numbers (or {value} objects) -- whatever the caller
// already has. Degenerate input (empty, one point, all zero, non-numeric)
// renders a flat mid-height line instead of throwing or drawing nothing.
export default function Sparkline({ points, width = 96, height = 24, ariaLabel }) {
  const values = (Array.isArray(points) ? points : []).map((p) =>
    num(typeof p === "object" && p !== null ? p.value : p)
  );

  const label =
    ariaLabel ||
    (values.length
      ? `Trend over ${values.length} points, from ${values[0]} to ${values[values.length - 1]}`
      : "No trend data");

  if (values.length === 0) {
    return (
      <svg
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--chart-grid)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const maxRaw = Math.max(...values);
  const max = maxRaw === min ? min + 1 : maxRaw; // flat series still draws a flat line, not a divide-by-zero
  const pad = 3; // keeps a 2px stroke from clipping at the top/bottom edge
  const d = values
    .map((v, i) => {
      const x = values.length === 1 ? width / 2 : scale(i, 0, values.length - 1, pad, width - pad);
      const y = scale(v, min, max, height - pad, pad);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <path d={d} fill="none" stroke="var(--chart-series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
