"use client";

import CharacterLink from "@/app/components/CharacterLink";
import ResourceChip from "@/app/components/ResourceChip";
import ZoneChip from "@/app/components/ZoneChip";
import TagChip from "@/app/components/TagChip";

// One audit sentence, rendered. describeAudit() (web/lib/auditNarrative.js)
// decides WHAT the segments are; this decides how each draws — a tag as a
// .chip, a Resources amount as the ⬢ pill, a character as a real link.
// `tagsByName` is optional: a "chip" segment is resolved by NAME (a
// `details` blob only ever carries a tag's name, not its id) against the
// current catalog. No catalog, or no match, just falls back to a flat span.
export default function AuditSegments({ entry, segments, tagsByName = null }) {
  return (
    <span className="audit-line">
      {segments.map((s, i) => (
        <Segment key={i} entry={entry} seg={s} tagsByName={tagsByName} />
      ))}
    </span>
  );
}

function Segment({ entry, seg, tagsByName }) {
  switch (seg.k) {
    case "t":
      return <span>{seg.v}</span>;
    case "em":
      return <strong className="audit-em">{seg.v}</strong>;
    case "mono":
      return <span className="mono text-xs">{seg.v}</span>;
    case "chip": {
      const tag = tagsByName?.get(seg.v) ?? null;
      return tag ? <TagChip tag={tag} /> : <span className="chip">{seg.v}</span>;
    }
    case "qty":
      return <span className="mono text-xs">×{seg.v}</span>;
    case "res":
      return <ResourceChip value={seg.v} />;
    case "zone":
      return <ZoneChip zoneName={seg.v} />;
    case "actor":
      // The actor is a Discord identity first — a GM often has no character — linked only when there is one.
      return entry.actor.characterId ? (
        <CharacterLink characterId={entry.actor.characterId} name={entry.actor.name} isGm />
      ) : (
        <strong className="audit-em">{entry.actor.name}</strong>
      );
    case "target":
      return entry.target ? (
        <CharacterLink characterId={entry.target.id} name={entry.target.name} isGm />
      ) : (
        <span className="text-muted">someone</span>
      );
    default:
      return null;
  }
}
