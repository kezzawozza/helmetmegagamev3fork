import { num, seriesColor } from "./chartUtils";
import { VisuallyHiddenTable, EmptyChart } from "./StackedArea";

// Server component: nodes placed evenly around a circle, links drawn as
// quadratic curves through the circle's center, stroke width proportional to
// value. Reads "who traded with whom" -- not a precise chord diagram with
// arc-length-proportional segments, just node position + link weight, which
// is enough to see hubs and pairs at a glance.
//
// `nodes`: [{ id, label }]. `links`: [{ source, target, value }].
export default function ArcWeb({ nodes, links, width = 360, height = 360 }) {
  const nodeList = Array.isArray(nodes) ? nodes.filter((n) => n && n.id != null) : [];
  const linkList = (Array.isArray(links) ? links : []).filter(
    (l) => l && nodeList.some((n) => n.id === l.source) && nodeList.some((n) => n.id === l.target) && l.source !== l.target
  );

  if (nodeList.length === 0) {
    return <EmptyChart width={width} height={height} label="No trade data" />;
  }

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(1, Math.min(width, height) / 2 - 40);

  const angleOf = (i) => (nodeList.length <= 1 ? -Math.PI / 2 : -Math.PI / 2 + (2 * Math.PI * i) / nodeList.length);
  const posOf = (i) => {
    const a = angleOf(i);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  const indexOf = new Map(nodeList.map((n, i) => [n.id, i]));
  const maxValue = Math.max(1, ...linkList.map((l) => num(l.value)));

  const label = `Trade web: ${nodeList.length} parties, ${linkList.length} connections`;

  return (
    <div className="viz-root">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {linkList.map((l, i) => {
          const [x1, y1] = posOf(indexOf.get(l.source));
          const [x2, y2] = posOf(indexOf.get(l.target));
          const strokeW = Math.max(1, (num(l.value) / maxValue) * 8);
          return (
            <path
              key={`${l.source}->${l.target}-${i}`}
              d={`M${x1.toFixed(2)},${y1.toFixed(2)} Q${cx},${cy} ${x2.toFixed(2)},${y2.toFixed(2)}`}
              fill="none"
              stroke={seriesColor(indexOf.get(l.source) ?? 0)}
              strokeOpacity={0.5}
              strokeWidth={strokeW}
              strokeLinecap="round"
            />
          );
        })}
        {nodeList.map((n, i) => {
          const [x, y] = posOf(i);
          const a = angleOf(i);
          const labelX = cx + (r + 14) * Math.cos(a);
          const labelY = cy + (r + 14) * Math.sin(a);
          return (
            <g key={n.id}>
              <circle cx={x} cy={y} r={5} fill="var(--chart-axis)" stroke="var(--surface, #fff)" strokeWidth={2} />
              <text
                x={labelX}
                y={labelY}
                textAnchor={Math.cos(a) > 0.15 ? "start" : Math.cos(a) < -0.15 ? "end" : "middle"}
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--text-secondary, var(--muted))"
              >
                {n.label ?? String(n.id)}
              </text>
            </g>
          );
        })}
      </svg>
      <VisuallyHiddenTable
        caption="Trades between parties"
        columns={["From", "To", "Value"]}
        rows={linkList.map((l) => [
          nodeList.find((n) => n.id === l.source)?.label ?? l.source,
          nodeList.find((n) => n.id === l.target)?.label ?? l.target,
          num(l.value),
        ])}
      />
    </div>
  );
}
