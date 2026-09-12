import { num, seriesColor } from "./chartUtils";
import { VisuallyHiddenTable, EmptyChart } from "./StackedArea";

// Server component: a simple layered Sankey, not a general solver. Nodes are
// assigned a column (0 = faucet, 1 = account, 2 = sink) either from an
// explicit `column` field or inferred from which side of the links they sit
// on; within a column, node height is proportional to its total throughput
// and nodes stack top to bottom with a fixed gap. Links are cubic-bezier
// ribbons between column edges, width proportional to value. Good enough to
// be readable for the handful of faucets/sinks this game has; not meant to
// match a real Sankey layout algorithm's edge-crossing minimization.
//
// `nodes`: [{ id, label, column? }]. `links`: [{ source, target, value }],
// source/target are node ids.
export default function Sankey({ nodes, links, width = 640, height = 360 }) {
  const nodeList = Array.isArray(nodes) ? nodes.filter((n) => n && n.id != null) : [];
  const linkList = (Array.isArray(links) ? links : []).filter(
    (l) => l && nodeList.some((n) => n.id === l.source) && nodeList.some((n) => n.id === l.target)
  );

  if (nodeList.length === 0) {
    return <EmptyChart width={width} height={height} label="No flow data" />;
  }

  const hasIncoming = new Set(linkList.map((l) => l.target));
  const hasOutgoing = new Set(linkList.map((l) => l.source));

  const columnOf = (n) => {
    if (n.column === 0 || n.column === 1 || n.column === 2) return n.column;
    if (!hasIncoming.has(n.id)) return 0;
    if (!hasOutgoing.has(n.id)) return 2;
    return 1;
  };

  const throughputOf = (id) => {
    const out = linkList.filter((l) => l.source === id).reduce((s, l) => s + num(l.value), 0);
    const inc = linkList.filter((l) => l.target === id).reduce((s, l) => s + num(l.value), 0);
    return Math.max(out, inc, 0.0001); // never zero -- keeps a throughput-less node visible as a thin bar
  };

  const columns = [[], [], []];
  nodeList.forEach((n) => columns[columnOf(n)].push(n));

  const padX = 12;
  const padY = 12;
  const nodeW = 14;
  const gap = 8;
  const innerH = Math.max(1, height - padY * 2);
  const colX = [padX, width / 2 - nodeW / 2, width - padX - nodeW];

  const layout = new Map(); // id -> { x, y, h, column, label }
  columns.forEach((col, colIdx) => {
    const totalThroughput = col.reduce((s, n) => s + throughputOf(n.id), 0) || 1;
    const totalGap = gap * Math.max(0, col.length - 1);
    const usableH = Math.max(1, innerH - totalGap);
    let y = padY;
    col.forEach((n) => {
      const h = Math.max(4, (throughputOf(n.id) / totalThroughput) * usableH);
      layout.set(n.id, { x: colX[colIdx], y, h, column: colIdx, label: n.label ?? String(n.id) });
      y += h + gap;
    });
  });

  // Track how much of each node's height has been consumed by links drawn so
  // far, so multiple ribbons off one node stack rather than overlap.
  const sourceCursor = new Map();
  const targetCursor = new Map();

  const ribbons = linkList.map((l, i) => {
    const s = layout.get(l.source);
    const t = layout.get(l.target);
    if (!s || !t) return null;
    const v = num(l.value);
    const sTotal = linkList.filter((x) => x.source === l.source).reduce((sum, x) => sum + num(x.value), 0) || 1;
    const tTotal = linkList.filter((x) => x.target === l.target).reduce((sum, x) => sum + num(x.value), 0) || 1;
    const sH = (v / sTotal) * s.h;
    const tH = (v / tTotal) * t.h;
    const sY0 = s.y + (sourceCursor.get(l.source) || 0);
    const tY0 = t.y + (targetCursor.get(l.target) || 0);
    sourceCursor.set(l.source, (sourceCursor.get(l.source) || 0) + sH);
    targetCursor.set(l.target, (targetCursor.get(l.target) || 0) + tH);

    const x1 = s.x + nodeW;
    const x2 = t.x;
    const midX = (x1 + x2) / 2;
    const d = [
      `M${x1},${sY0.toFixed(2)}`,
      `C${midX},${sY0.toFixed(2)} ${midX},${tY0.toFixed(2)} ${x2},${tY0.toFixed(2)}`,
      `L${x2},${(tY0 + tH).toFixed(2)}`,
      `C${midX},${(tY0 + tH).toFixed(2)} ${midX},${(sY0 + sH).toFixed(2)} ${x1},${(sY0 + sH).toFixed(2)}`,
      "Z",
    ].join(" ");

    const sourceIdx = nodeList.findIndex((n) => n.id === l.source);
    return { key: `${l.source}->${l.target}-${i}`, d, color: seriesColor(Math.max(0, sourceIdx)) };
  }).filter(Boolean);

  const label = `Flow diagram: ${nodeList.length} accounts, ${linkList.length} flows`;

  return (
    <div className="viz-root">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {ribbons.map((r) => (
          <path key={r.key} d={r.d} fill={r.color} fillOpacity={0.45} />
        ))}
        {nodeList.map((n) => {
          const l = layout.get(n.id);
          if (!l) return null;
          return (
            <g key={n.id}>
              <rect x={l.x} y={l.y} width={nodeW} height={l.h} rx={3} fill="var(--chart-axis)" />
              <text
                x={l.column === 2 ? l.x - 6 : l.x + nodeW + 6}
                y={l.y + l.h / 2}
                dominantBaseline="middle"
                textAnchor={l.column === 2 ? "end" : "start"}
                fontSize={11}
                fill="var(--text-secondary, var(--muted))"
              >
                {l.label}
              </text>
            </g>
          );
        })}
      </svg>
      <VisuallyHiddenTable
        caption="Flows between accounts"
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
