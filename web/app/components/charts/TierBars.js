import { num, seriesColor } from "./chartUtils";
import { VisuallyHiddenTable, EmptyChart } from "./StackedArea";

// Server component — a small, fixed-category bar strip. Built for the
// Desire tier histogram (1-7, 6 deliberately always empty per
// DesireTemplate.tier's comment): the one axis in the app so far small and
// fixed enough (<=8 categories) for SERIES_VARS' per-category colouring to
// read as more than noise, rather than a ranked/named list better shown as a
// sortable table.
//
// `bars`: [{ label, count }], in display order (left to right).
export default function TierBars({ bars, width = 320, height = 160 }) {
  const rows = Array.isArray(bars) ? bars : [];
  if (rows.length === 0) {
    return <EmptyChart width={width} height={height} label="No tier data" />;
  }

  const padB = 20;
  const innerH = Math.max(1, height - padB);
  const max = Math.max(1, ...rows.map((r) => num(r.count)));
  const gap = 6;
  const slot = width / rows.length;
  const barW = Math.max(4, slot - gap);

  const label = `Claims by tier, ${rows.length} categories`;

  return (
    <div className="viz-root">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <line x1={0} y1={height - padB} x2={width} y2={height - padB} stroke="var(--chart-axis)" strokeWidth={1} />
        {rows.map((r, i) => {
          const h = (num(r.count) / max) * innerH;
          const x = slot * i + (slot - barW) / 2;
          return (
            <g key={r.label ?? i}>
              <rect
                x={x.toFixed(2)}
                y={(height - padB - h).toFixed(2)}
                width={barW.toFixed(2)}
                height={h.toFixed(2)}
                rx={3}
                fill={seriesColor(i)}
              />
              <text x={(x + barW / 2).toFixed(2)} y={height - 6} textAnchor="middle" fill="var(--chart-axis)" fontSize={11}>
                {r.label}
              </text>
            </g>
          );
        })}
      </svg>
      <VisuallyHiddenTable caption="Claims by tier" columns={["Tier", "Claims"]} rows={rows.map((r) => [r.label, num(r.count)])} />
    </div>
  );
}
