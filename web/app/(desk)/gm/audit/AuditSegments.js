"use client";

import CharacterLink from "@/app/components/CharacterLink";
import ResourceChip from "@/app/components/ResourceChip";
import ZoneChip from "@/app/components/ZoneChip";
import TagChip from "@/app/components/TagChip";

// One audit sentence, rendered. describeAudit() (web/lib/auditNarrative.js)
// decides WHAT the segments are; this decides how each draws — a tag as a
// .chip, a Resources amount as the ⬢ pill, a character as a real link.
// Both maps are optional. A "chip" segment resolves BY ID first and falls back
// to the name, because a log row snapshots a name (ARCHITECTURE.md) and most —
// not all — writers store the id beside it. No match either way falls back to a
// flat span, the same "fallen out of the catalog" behaviour every tag chip has.
//
// `tagsByName` HOLDS NO RUNTIME-MINTED ROW, and that is a rule rather than a
// tidy-up: paperName() names every untitled note "A Note", so a name-keyed map
// collapses them and would hand one player's letter back for another's. An old
// row with no id therefore draws a flat chip — no hover is the honest answer
// when we cannot tell which note it was. AuditDesk.js builds both maps.
export default function AuditSegments({ entry, segments, tagsByName = null, tagsById = null }) {
  return (
    <span className="audit-line">
      {segments.map((s, i) => (
        <Segment key={i} entry={entry} seg={s} tagsByName={tagsByName} tagsById={tagsById} />
      ))}
    </span>
  );
}

function Segment({ entry, seg, tagsByName, tagsById }) {
  switch (seg.k) {
    case "t":
      return <span>{seg.v}</span>;
    case "em":
      return <strong className="audit-em">{seg.v}</strong>;
    case "mono":
      return <span className="mono text-xs">{seg.v}</span>;
    case "chip": {
      const tag = (seg.id ? tagsById?.get(seg.id) : null) ?? tagsByName?.get(seg.v) ?? null;
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
