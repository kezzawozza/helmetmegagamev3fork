// Renders a {resource:field:tier} token (see RichText.js) as the live-computed payout, e.g. "3" or "0–4".
// No tooltip/tabIndex on purpose. `chip-mono` is load-bearing for the mono face
// (see the fonts section of CLAUDE.md).
export default function ResourceChip({ value }) {
  return <span className="chip chip-mono">{value} ⬢</span>;
}
