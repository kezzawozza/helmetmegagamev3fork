import { num, scale, compactNumber } from "./chartUtils";
import { VisuallyHiddenTable, EmptyChart } from "./StackedArea";

// Server component -- one bar per turn, no interaction needed to read "minted
// vs burned"; the shared value tokens plus the visible cap label carry it.
//
// `points`: [{ x, positive, negative }] -- positive/negative are both given
// as non-negative magnitudes; this component draws the negative one downward
// from the zero line. `title`/`positiveLabel`/`negativeLabel` default to the
// original mint/burn copy so every existing call site (Pulse.js) needs no
// changes; a caller charting a different diverging pair (e.g. fulfilled vs
// cancelled) overrides them instead of reading "Minted"/"Burned" on the wrong data.
export default function DivergingBars({
  points,
  width = 640,
  height = 220,
  title = "Minted versus burned resources",
  positiveLabel = "Minted",
  negativeLabel = "Burned",
}) {
  const rows = Array.isArray(points) ? points : [];
  if (rows.length === 0) {
    return <EmptyChart width={width} height={height} label="No mint/burn data for this range" />;
  }

  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 16;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = Math.max(1, height - padT - padB);
  const zeroY = padT + innerH / 2;

  const maxMag = Math.max(1, ...rows.map((r) => Math.max(num(r.positive), num(r.negative))));

  const gap = 2; // the house surface gap between adjacent bars
  const slot = innerW / rows.length;
  const barW = Math.max(1, Math.min(24, slot - gap));

  const label = `${title} over ${rows.length} turns`;

  return (
    <div className="viz-root">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <line x1={padL} y1={zeroY} x2={width - padR} y2={zeroY} stroke="var(--chart-axis)" strokeWidth={1} />
        {rows.map((r, i) => {
          const cx = padL + slot * i + slot / 2;
          const posH = scale(num(r.positive), 0, maxMag, 0, innerH / 2);
          const negH = scale(num(r.negative), 0, maxMag, 0, innerH / 2);
          return (
            <g key={r.x ?? i}>
              <rect
                x={(cx - barW / 2).toFixed(2)}
                y={(zeroY - posH).toFixed(2)}
                width={barW}
                height={posH.toFixed(2)}
                rx={4}
                fill="var(--chart-pos)"
              />
              <rect
                x={(cx - barW / 2).toFixed(2)}
                y={zeroY.toFixed(2)}
                width={barW}
                height={negH.toFixed(2)}
                rx={4}
                fill="var(--chart-neg)"
              />
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          font: "var(--fs-sm, 0.8rem)/1.2 var(--font-sans)",
          color: "var(--text-secondary, var(--muted))",
          marginTop: "0.5rem",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: "var(--chart-pos)" }} />
          {positiveLabel}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: "var(--chart-neg)" }} />
          {negativeLabel}
        </span>
        <span className="mono">peak {compactNumber(maxMag)}</span>
      </div>
      <VisuallyHiddenTable
        caption={`${title} per turn`}
        columns={["Turn", positiveLabel, negativeLabel]}
        rows={rows.map((r, i) => [r.x ?? i + 1, num(r.positive), num(r.negative)])}
      />
    </div>
  );
}
