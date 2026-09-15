import { formatCost, costColor, prerequisiteNames } from "@/lib/characterCreation";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { formatTagArmor } from "@/lib/formatTagArmor";
import { formatTagFighting } from "@/lib/formatTagFighting";
import { formatTagWeight } from "@/lib/formatTagWeight";
import { turnsLeft, tagDuration } from "@/lib/turnFormat";
import { chainTokens } from "@/lib/tagChains";
// The deep path, not the @lifeweb/db barrel: PointBuy renders this in a "use client"
// bundle, and the barrel would drag @prisma/client into it.
import { describeEquipFit } from "@lifeweb/db/lib/equipSlots";
import DesireUnlocks from "./DesireUnlocks";
import ChipText from "./ChipText";
import PaperSheet from "./PaperSheet";

// Everything a tag has to say about itself, as one block. TagChip.js renders it inside a
// HoverCard, TagRow.js renders it inline, so the two can never disagree about what a tag is.
// No hooks and no "use client", so TagChip keeps rendering on the server.

// The countdown a held tag shows, or the catalog wording for a bare one, or the bomb's own
// clock. Exported because the chip's face and this block both read it and must agree.
export function tagDurationFor({ tag, expiresTurn = null, currentTurn = null, armedTurn = null }) {
  if (armedTurn != null) {
    return {
      label: `Armed. It fires as turn ${armedTurn} closes.`,
      badge: `armed · ${turnsLeft(armedTurn, currentTurn) ?? "?"}t`,
      armed: true,
    };
  }
  // The CharacterTag's expiresTurn, not the Tag's defaultDurationTurns — the clock started
  // when it was granted. Null for a bare catalog reference falls back to the catalog wording.
  return tagDuration(turnsLeft(expiresTurn, currentTurn), tag?.defaultDurationTurns);
}

// Tag.inspectVisibility as a sentence. NAMED needs saying out loud rather than reading as
// a plain "Yes": it is why a hood or Disguise Kit is worth buying when Wanted (db/lib/medicalVision.js).
const SEEN_BY_OTHERS = {
  WORN: "Only while worn",
  NAMED: "Only under your own name",
  ALWAYS: "Yes",
};

// Tag.cures — a flat slug list, not chainTokens' { oneOf } shape: cures everything on the
// list the target holds, not a random pick between them (TAGS.md §5c).
function curesTokens(cures) {
  if (!Array.isArray(cures) || !cures.length) return null;
  return cures.map((slug) => `{tag:${slug}}`).join(" and ");
}

function Meta({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export default function TagDetails({
  tag,
  quantity = 1,
  expiresTurn = null,
  currentTurn = null,
  armedTurn = null,
  // Whether {tag:…} tokens inside may become real, hoverable chips.
  inTooltip = true,
  // Slot for a control that acts on the holding — TagChip's Consume button and its error line.
  children = null,
  // The name row is the chip's own face on a row, so the row can drop it.
  showName = true,
  // "· smells wrong" — already gated server-side to poison-sense/poison-snooper holders.
  // Never the raw poisonedCount or which poison: only the yes/no doctor's-eye read.
  poisonMarker = false,
}) {
  const stack = quantity > 1 ? quantity : null;
  const requirement = formatTagRequirement(tag);
  const armor = formatTagArmor(tag);
  const fighting = formatTagFighting(tag);
  const weight = formatTagWeight(tag, quantity);
  const duration = tagDurationFor({ tag, expiresTurn, currentTurn, armedTurn });
  const fit = describeEquipFit(tag);
  const becomes = chainTokens(tag.expiresInto);
  const treated = chainTokens(tag.removesInto);
  const cures = curesTokens(tag.cures);
  // `paperKind` rides in the narrow select and `paper` only appears once
  // composeChipTag has run, so the pair tells "uncomposed" from "not paper".
  const uncomposedPaper = Boolean(tag.paperKind) && !tag.paper;
  if (uncomposedPaper && process.env.NODE_ENV !== "production") {
    console.error(
      `TagDetails: "${tag.slug ?? tag.name}" is a paper row that was never composed. ` +
        "Its query wants chipSelect() and composeChipTag() — see web/lib/tagChipRows.js.",
    );
  }

  return (
    <>
      {showName && (
        <div className="flex items-start justify-between gap-2">
          <strong>
            {tag.name}
            {stack ? ` ×${stack}` : ""}
            {poisonMarker && <span className="text-muted"> · smells wrong</span>}
          </strong>
          {(tag.group?.name || tag.category) && (
            <span className="text-muted whitespace-nowrap text-xs">
              {[tag.group?.name, tag.category].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      )}
      {tag.paper ? (
        <PaperSheet paper={tag.paper} />
      ) : (
        tag.description && <ChipText text={tag.description} as="p" inTooltip={inTooltip} />
      )}
      {/* A paper row with no composed `paper` got here off a select that
          skipped composeChipTag (web/lib/tagChipRows.js) — its words live in
          `paperText` and its `description` column is null, so both branches
          above draw nothing. That silence is exactly how every paper on
          /gm/turns hovered blank for months. Say so instead. Production gets
          the honest line and no invented text; a dev gets told which tag and
          what to fix. */}
      {uncomposedPaper && <p className="text-muted text-xs">Nothing loaded about this one.</p>}
      {children}
      <dl className="tag-meta">
        {duration && <Meta label={duration.armed ? "Armed" : "Expires"}>{duration.label}</Meta>}
        {becomes && (
          <Meta label="Becomes">
            <ChipText text={becomes} inTooltip={inTooltip} />
          </Meta>
        )}
        {treated && (
          <Meta label="Treated">
            <ChipText text={treated} inTooltip={inTooltip} />
          </Meta>
        )}
        {/* What this item cures when consumed or administered (TAGS.md §5c). */}
        {cures && (
          <Meta label="Cures">
            <ChipText text={cures} inTooltip={inTooltip} />
          </Meta>
        )}
        {/* Labelled, not bare: formatTagRequirement's leading "1t" is turns of WORK, which
            collided with the expiry countdown's own "1t" when both sat unlabelled. */}
        {requirement && (
          <Meta label={tag.craftable ? "Recipe" : tag.healable ? "Cure" : "Requirement"}>
            {requirement}
          </Meta>
        )}
        {/* What this ONE tag does in a fight — never the holder's band, deliberately
            not readable off a chip (COMBAT.md). Above Armour: how you hit, then what happens when hit. */}
        {fighting && <Meta label="In a fight">{fighting}</Meta>}
        {armor && <Meta label="Armour">{armor}</Meta>}
        {weight && <Meta label="Weight">{weight}</Meta>}
        {/* Appraisal's readout (TAGS.md §4a): only present when the viewer holds the skill
            (web/lib/appraisal.js). Drawn even with no price, so the appraiser knows the skill fired. */}
        {"valueObols" in tag && (
          <Meta label="Worth">
            <span className="mono">{tag.valueObols != null ? `${tag.valueObols} ¢` : "—"}</span>
          </Meta>
        )}
        {/* Where it goes and what it costs to put there. */}
        {fit && <Meta label="Worn">{fit}</Meta>}
        {tag.inspectVisibility && tag.inspectVisibility !== "HIDDEN" && (
          <Meta label="Seen by others">{SEEN_BY_OTHERS[tag.inspectVisibility] ?? "Yes"}</Meta>
        )}
        {tag.concealsIdentity && (
          <Meta label="Conceals you">{tag.forcesConceal ? "Always, while worn" : "Optional, while worn"}</Meta>
        )}
        {prerequisiteNames(tag).length > 0 && (
          <Meta label="Requires">{prerequisiteNames(tag).join(", ")}</Meta>
        )}
        <Meta label="Cost">
          <span style={{ color: costColor(tag.pointCost) }}>
            {formatCost(tag.pointCost)} {Math.abs(tag.pointCost ?? 0) === 1 ? "pt" : "pts"}
          </span>
        </Meta>
      </dl>
      <DesireUnlocks tag={tag} />
    </>
  );
}
