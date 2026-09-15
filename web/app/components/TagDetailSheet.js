"use client";

import { useMemo } from "react";
import Modal from "@/app/components/Modal";
import ChipText from "@/app/components/ChipText";
import ChipLabel from "@/app/components/ChipLabel";
import DesireUnlocks from "@/app/components/DesireUnlocks";
import { formatCost, costColor } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { formatTagArmor } from "@/lib/formatTagArmor";
import { formatTagWeight } from "@/lib/formatTagWeight";
import { chainTokens } from "@/lib/tagChains";
import { SLOT_TITLES, LAYER_NAMES } from "@lifeweb/db/lib/equipSlots";
import PaperSheet from "./PaperSheet";

// The read-only detail sheet behind a row click on the Tag Catalog: the full
// description plus everything the table can't fit — the tier chain, the
// prerequisite links, group siblings, and what the tag consumes or decays
// into. Every related tag is a button that re-opens the sheet on it, so a
// chain can be walked without touching the table.
//
// Read-only on purpose, YAML row or not: this is the designer's reading
// view. Editing stays where it was — the pencil for custom tags, the YAML
// for everything else.
//
// Shared by the GM catalog (/gm/dev/tags) and the player-facing Tag Catalog
// tab on /documents. The GM caller ships `held` and `custom`; the player
// payload (web/lib/tagCatalog.js) ships neither, so the rows below that
// depend on them are conditional rather than assumed.

// The group-peers row label: "All Tonics", "All Buffs". Already-plural names
// (Traits, Wounds) pass through; "The Watch" / "The Court" read as
// "All of The Watch" rather than growing a bad plural.
function allOfGroupLabel(name) {
  if (!name) return "All";
  if (name.startsWith("The ")) return `All of ${name}`;
  if (name.endsWith("s")) return `All ${name}`;
  if (name.endsWith("y")) return `All ${name.slice(0, -1)}ies`;
  return `All ${name}s`;
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// ChipLabel reads `category` for its rule and `group.slug` for its icon; the
// detail sheet's rows are hand-picked columns rather than full Tag rows, so
// this hands over just those two rather than widening that query.
function chipShape(tag) {
  return { name: tag.name, category: tag.category ?? null, group: tag.group ?? null };
}

// "Worn: body · over · two hands" — where a piece of kit sits, for the chip
// row. Null for anything that is not worn.
//
// The row title rather than the raw enum, since the off hand folded into the
// hands and `equipSlot.toLowerCase()` would read "weapon" under a shield; and
// the layer's NAME rather than its number, since "layer 2" meant nothing
// without this table open beside you — and the numbers moved anyway when HEAD
// stopped being layered.
function wornLabel(tag) {
  if (!tag.equipSlot) return null;
  const where = (SLOT_TITLES[tag.equipSlot] ?? tag.equipSlot).toLowerCase();
  const layer = LAYER_NAMES[tag.equipSlot]?.[(tag.equipLayer ?? 0) - 1];
  return [`Worn: ${where}`, layer?.toLowerCase(), tag.twoHanded ? "two hands" : null]
    .filter(Boolean)
    .join(" · ");
}

function TagButton({ tag, onOpen }) {
  return (
    <button type="button" className="btn-quiet" onClick={() => onOpen(tag)}>
      <ChipLabel tag={chipShape(tag)} />
    </button>
  );
}

const FLAG_LABELS = [
  ["purchasable", "Purchasable"],
  ["purchasableAfterStart", "After-start"],
  ["mastery", "Mastery"],
  ["craftable", "Craftable"],
  ["stackable", "Stackable"],
  ["equippable", "Equippable"],
  ["concealsIdentity", "Conceals identity"],
  ["forcesConceal", "Conceals by force"],
  ["consumable", "Consumable"],
  ["removable", "Removable"],
  ["tradeable", "Tradeable"],
  ["healable", "Healable"],
  ["teachable", "Teachable"],
  ["administerable", "Administerable"],
];

// Tag.inspectVisibility isn't a flag, so it can't ride in FLAG_LABELS — but it
// belongs in the same chip row, since a reader scanning for "who can see this"
// shouldn't have to look in two places. HIDDEN renders nothing, same as an
// unset flag.
const VISIBILITY_CHIP = {
  ALWAYS: "Visible on 🔍",
  WORN: "Visible on 🔍 while worn",
  NAMED: "Visible on 🔍 under your own name",
};

export default function TagDetailSheet({ tag, tags, onOpen, onClose }) {
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const bySlug = useMemo(() => new Map(tags.map((t) => [t.slug, t])), [tags]);

  // Ancestors up the parentTag chain (closest first), children back down.
  const ancestors = useMemo(() => {
    const out = [];
    const seen = new Set([tag.id]);
    let current = tag.parentTagId ? byId.get(tag.parentTagId) : null;
    while (current && !seen.has(current.id)) {
      out.push(current);
      seen.add(current.id);
      current = current.parentTagId ? byId.get(current.parentTagId) : null;
    }
    return out;
  }, [tag, byId]);
  const children = useMemo(
    () => tags.filter((t) => t.parentTagId === tag.id),
    [tags, tag.id],
  );

  const requiredTag = tag.requiredTagId ? byId.get(tag.requiredTagId) : null;
  const prerequisiteFor = useMemo(
    () => tags.filter((t) => t.requiredTagId === tag.id),
    [tags, tag.id],
  );
  const siblings = useMemo(
    () => (tag.groupId ? tags.filter((t) => t.groupId === tag.groupId && t.id !== tag.id) : []),
    [tags, tag.groupId, tag.id],
  );

  const consumesInto = (tag.consumesInto ?? [])
    .map((slug) => bySlug.get(slug))
    .filter(Boolean);
  const becomes = chainTokens(tag.expiresInto, bySlug);
  const treated = chainTokens(tag.removesInto, bySlug);
  // Tag.cures (the medical pass, TAGS.md §5c) — what THIS item cures.
  const cures = (tag.cures ?? []).map((slug) => bySlug.get(slug)).filter(Boolean);
  // The derived reverse: every OTHER tag whose own `cures` names this one —
  // "Cured by", for a Health tag reader wondering what to reach for.
  const curedBy = useMemo(
    () => tags.filter((t) => t.id !== tag.id && (t.cures ?? []).includes(tag.slug)),
    [tags, tag.id, tag.slug],
  );
  const flags = [
    ...FLAG_LABELS.filter(([key]) => tag[key]).map(([, label]) => label),
    VISIBILITY_CHIP[tag.inspectVisibility],
    // Not a boolean: the name the holder is forced to wear (TAGS.md §5).
    tag.forcedName ? `Forces name: ${tag.forcedName}` : null,
    // Nor these: the face a concealed wearer shows, and where the thing sits.
    // Both are worth a chip rather than a fold — "which helmet slot is this?"
    // is the question a GM building kit actually asks.
    tag.concealSprite ? `Conceal sprite: ${tag.concealSprite}` : null,
    wornLabel(tag),
    // This sheet is the GM's door onto a tag, so it carries the raw numbers
    // the word scale hides everywhere else — tuning a piece of gear against
    // "Sufficient" would be guesswork.
    formatTagArmor(tag)
      ? `Armour: ${formatTagArmor(tag)} (${tag.meleeArmor ?? 0} / ${tag.ballisticArmor ?? 0})`
      : null,
    // What it costs the carry cap, per unit. Null for the weightless half of
    // the catalog and for anything a character does not haul (CARRY.md §1).
    formatTagWeight(tag) ? `Weighs ${formatTagWeight(tag)}` : null,
  ].filter(Boolean);
  const requirement = formatTagRequirement(tag);

  return (
    <Modal panelClassName="doc-sheet" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="doc-sheet-head mb-0 flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title flex items-center gap-2">
              <ChipLabel tag={chipShape(tag)} />
              <span className="text-base" style={{ color: costColor(tag.pointCost) }}>
                {formatCost(tag.pointCost)}
              </span>
            </h2>
            <p className="mono text-xs text-muted">
              {tag.slug} · {tag.category}
              {tag.groupName ? ` · ${tag.groupName}` : ""}
              {tag.custom != null ? ` · ${tag.custom ? "GM-created" : "docs/tags.yaml"}` : ""}
            </p>
          </div>
          <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {flags.map((label) => (
              <span key={label} className="chip">
                {label}
              </span>
            ))}
          </div>
        )}

        {tag.paper ? (
          <PaperSheet paper={tag.paper} />
        ) : tag.description ? (
          <ChipText text={tag.description} className="text-sm" />
        ) : (
          <p className="text-sm text-muted">No description yet — a stub awaiting prose.</p>
        )}

        <div className="flex flex-col gap-2">
          {requirement && <Row label="To acquire">{requirement}</Row>}
          {tag.defaultDurationTurns != null && (
            <Row label="Lasts">
              {tag.defaultDurationTurns} turn{tag.defaultDurationTurns === 1 ? "" : "s"}
            </Row>
          )}
          {becomes && (
            <Row label="Becomes">
              <ChipText text={becomes} as="span" />
            </Row>
          )}
          {treated && (
            <Row label="Treated">
              <ChipText text={treated} as="span" />
            </Row>
          )}
          {(ancestors.length > 0 || children.length > 0) && (
            <Row label="Chain">
              <span className="flex flex-wrap items-center gap-1">
                {[...ancestors].reverse().map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
                {ancestors.length > 0 && <span aria-hidden="true">→</span>}
                <span className="chip" aria-current="true">
                  <strong>{tag.name}</strong>
                </span>
                {children.length > 0 && <span aria-hidden="true">→</span>}
                {children.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {requiredTag && (
            <Row label="Requires">
              <TagButton tag={requiredTag} onOpen={onOpen} />
            </Row>
          )}
          {prerequisiteFor.length > 0 && (
            <Row label="Unlocks">
              <span className="flex flex-wrap gap-1">
                {prerequisiteFor.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {consumesInto.length > 0 && (
            <Row label="Consumes into">
              <span className="flex flex-wrap gap-1">
                {consumesInto.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {cures.length > 0 && (
            <Row label="Cures">
              <span className="flex flex-wrap gap-1">
                {cures.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {curedBy.length > 0 && (
            <Row label="Cured by">
              <span className="flex flex-wrap gap-1">
                {curedBy.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {siblings.length > 0 && (
            <Row label={allOfGroupLabel(tag.groupName)}>
              <span className="flex flex-wrap gap-1">
                {siblings.map((t) => (
                  <TagButton key={t.id} tag={t} onOpen={onOpen} />
                ))}
              </span>
            </Row>
          )}
          {tag.held != null && (
            <Row label="Held by">
              {tag.held ? `${tag.held} character${tag.held === 1 ? "" : "s"}` : "Nobody"}
            </Row>
          )}
        </div>
        {/* Below the rows, not inside them: the "Unlocks" Row above already
            means UNLOCKED TAGS, and two rows sharing that word would need the
            reader to tell them apart by their contents. This block names
            Desires in its own heading, so it says which "unlocks" it is.

            `visibleTagSlugs`: a co-requirement note must never print the name
            of a tag this viewer cannot see. `tags` is the list this sheet was
            handed, already filtered for whoever is reading — the GM catalog
            passes the unfiltered one, which is right for a GM. */}
        <DesireUnlocks
          tag={tag}
          compact={false}
          visibleTagSlugs={new Set(tags.map((t) => t.slug))}
        />
      </div>
    </Modal>
  );
}
