// A Desire's "Counts: … / Doesn't count: …" rule (docs/desires.yaml `description:`, DESIRES.md §10).
// One line per line of the description, with a leading "Counts:" or "Doesn't count:" set in bold.
// Spans only, so it sits inside the catalog's row button as well as in a dialog or the review desk.
export default function DesireRule({ text, className = "text-xs text-muted" }) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return (
    <span className={`flex flex-col gap-0.5 ${className}`}>
      {lines.map((line) => {
        const m = line.match(/^(Counts|Doesn't count):\s*(.*)$/);
        return (
          <span key={line}>
            {m ? <strong>{m[1]}:</strong> : null} {m ? m[2] : line}
          </span>
        );
      })}
    </span>
  );
}
