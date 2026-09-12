import { num, scale, seriesColor } from "./chartUtils";

// Server component. A hover crosshair would be the ideal finish here (see the
// dataviz skill's interaction.md), but this is the first chart component in
// the app and GM economy pages read from a server-rendered ledger snapshot --
// wiring a client-side tooltip layer is a follow-up, not a blocker for
// shipping the visual + its table fallback. The legend and the hidden table
// already carry every exact value, so nothing is gated behind hover.
//
// `series`: [{ key, label }] identifies each stacked band, in the order they
// stack (bottom to top). `categories`: [{ x, values: { [key]: number } }] is
// one entry per turn. Missing/non-numeric values read as 0.
export default function StackedArea({ series, categories, width = 640, height = 220 }) {
  const seriesList = Array.isArray(series) ? series.filter((s) => s && s.key) : [];
  const points = Array.isArray(categories) ? categories : [];

  if (seriesList.length === 0 || points.length === 0) {
    return <EmptyChart width={width} height={height} label="No money-supply data for this range" />;
  }

  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);

  const totals = points.map((c) => seriesList.reduce((sum, s) => sum + num(c.values?.[s.key]), 0));
  const maxTotal = Math.max(1, ...totals);

  const xAt = (i) => (points.length === 1 ? padL + innerW / 2 : padL + scale(i, 0, points.length - 1, 0, innerW));

  // Running cumulative sum per point, so each series draws the band between
  // its own cumulative top and the previous series' cumulative top.
  const cumulative = points.map(() => 0);
  const bands = seriesList.map((s, sIdx) => {
    const baseline = [...cumulative];
    const top = points.map((c, i) => {
      const v = num(c.values?.[s.key]);
      cumulative[i] += v;
      return cumulative[i];
    });
    const topY = top.map((v) => padT + scale(v, 0, maxTotal, innerH, 0));
    const baseY = baseline.map((v) => padT + scale(v, 0, maxTotal, innerH, 0));
    const forward = points.map((c, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${topY[i].toFixed(2)}`).join(" ");
    const backward = [...points]
      .map((c, i) => i)
      .reverse()
      .map((i) => `L${xAt(i).toFixed(2)},${baseY[i].toFixed(2)}`)
      .join(" ");
    return { key: s.key, label: s.label || s.key, d: `${forward} ${backward} Z`, color: seriesColor(sIdx) };
  });

  const tableLabel = `Money supply by form over ${points.length} turns: ${seriesList
    .map((s) => s.label || s.key)
    .join(", ")}`;

  return (
    <div className="viz-root">
      <svg
        role="img"
        aria-label={tableLabel}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="var(--chart-axis)" strokeWidth={1} />
        {bands.map((b) => (
          <path key={b.key} d={b.d} fill={b.color} fillOpacity={0.85} />
        ))}
      </svg>
      <Legend items={bands.map((b) => ({ label: b.label, color: b.color }))} />
      <VisuallyHiddenTable
        caption="Money supply by form over turns"
        columns={["Turn", ...seriesList.map((s) => s.label || s.key)]}
        rows={points.map((c, i) => [
          c.x ?? i + 1,
          ...seriesList.map((s) => num(c.values?.[s.key])),
        ])}
      />
    </div>
  );
}

export function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <ul
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem",
        listStyle: "none",
        margin: "0.5rem 0 0",
        padding: 0,
        font: "var(--fs-sm, 0.8rem)/1.2 var(--font-sans)",
        color: "var(--text-secondary, var(--muted))",
      }}
    >
      {items.map((it) => (
        <li key={it.label} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: "inline-block" }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

// A sr-only table: every chart's exact numbers, for a screen-reader user or
// anyone who wants to copy values rather than read a curve.
export function VisuallyHiddenTable({ caption, columns, rows }) {
  return (
    <table
      className="mono"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EmptyChart({ width = 640, height = 220, label = "No data" }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <line
        x1={8}
        y1={height / 2}
        x2={width - 8}
        y2={height / 2}
        stroke="var(--chart-grid)"
        strokeWidth={1}
      />
      <text x={width / 2} y={height / 2 - 8} textAnchor="middle" fill="var(--chart-axis)" fontSize={12}>
        {label}
      </text>
    </svg>
  );
}
