import { num, scale } from "./chartUtils";
import { VisuallyHiddenTable, EmptyChart } from "./StackedArea";

// Server component. `points`: [{ p, q }] already-computed cumulative-share
// pairs (p = share of population, q = share of wealth), 0..1, sorted
// ascending. `gini` is the precomputed coefficient, called out as text next
// to the curve rather than re-derived here -- this component only draws.
export default function Lorenz({ points, gini, width = 320, height = 320 }) {
  const rows = Array.isArray(points) ? points.filter((r) => r && Number.isFinite(num(r.p))) : [];

  if (rows.length === 0) {
    return <EmptyChart width={width} height={height} label="No distribution data" />;
  }

  const pad = 24;
  const inner = Math.max(1, Math.min(width, height) - pad * 2);
  const x0 = pad;
  const y0 = height - pad;

  const toXY = (p, q) => [x0 + scale(p, 0, 1, 0, inner), y0 - scale(q, 0, 1, 0, inner)];

  const d = rows
    .map((r, i) => {
      const [x, y] = toXY(num(r.p), num(r.q));
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const giniText = Number.isFinite(num(gini, NaN)) ? num(gini).toFixed(2) : "n/a";
  const label = `Lorenz curve of resource distribution. Gini coefficient ${giniText}`;

  return (
    <div className="viz-root">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Axes */}
        <line x1={x0} y1={y0} x2={x0 + inner} y2={y0} stroke="var(--chart-axis)" strokeWidth={1} />
        <line x1={x0} y1={y0} x2={x0} y2={y0 - inner} stroke="var(--chart-axis)" strokeWidth={1} />
        {/* Equality diagonal */}
        <line
          x1={x0}
          y1={y0}
          x2={x0 + inner}
          y2={y0 - inner}
          stroke="var(--chart-grid)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        {/* The curve itself */}
        <path d={d} fill="none" stroke="var(--chart-series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div
        className="mono"
        style={{
          font: "var(--fs-sm, 0.8rem)/1.2 var(--font-sans)",
          color: "var(--text-secondary, var(--muted))",
          marginTop: "0.5rem",
        }}
      >
        Gini {giniText} <span style={{ color: "var(--chart-grid)" }}>·</span> dashed line is perfect equality
      </div>
      <VisuallyHiddenTable
        caption="Lorenz curve points (cumulative population share, cumulative wealth share)"
        columns={["Population share", "Wealth share"]}
        rows={rows.map((r) => [num(r.p).toFixed(3), num(r.q).toFixed(3)])}
      />
    </div>
  );
}
