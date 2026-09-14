import TagChip from "@/app/components/TagChip";

// Renders effectSegments() (stagedFormat.js) — a hoverable TagChip for a
// resolved tag op, plain text otherwise, flat span for a since-deleted tag.
export default function EffectSegments({ segments }) {
  if (!segments.length) return "nothing";
  return segments.map((seg, i) => (
    <span key={i}>
      {i > 0 && " · "}
      {seg.k === "tagchip" ? (
        <>
          {seg.op === "add" ? "+" : "−"}
          {seg.tag ? (
            <TagChip tag={seg.tag} quantity={seg.quantity ?? 1} />
          ) : (
            <span className="chip">{seg.name}</span>
          )}
        </>
      ) : (
        seg.v
      )}
    </span>
  ));
}
