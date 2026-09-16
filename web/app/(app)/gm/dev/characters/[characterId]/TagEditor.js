"use client";

import { useCallback, useMemo, useState } from "react";
import TagCatalogBrowser from "@/app/components/TagCatalogBrowser";
import CustomTagDialog from "@/app/components/CustomTagDialog";
import QuantityField from "@/app/components/QuantityField";

// The GM's tag surface, sibling to the player's PointBuy store but bypassing
// every gate: all categories including hidden ones, no budget (tagPoints
// edits directly on Identity). Add-only — search, grant, create custom. The
// character's actual holdings display in the panel's main body now
// (HeldTagsBody.js), grouped the way the player's own sheet is, and every
// verb that acts on an EXISTING holding (quantity, equip, remove, make
// permanent) lives there. This tab used to carry both jobs in one "Holds" +
// catalog split; the two are different questions — "what does this
// character have" and "what am I adding" — and conflating them is why a
// Grant button here once quietly meant something different from the
// stepper sitting above it.
//
// Everything here COMMITS ON THE GESTURE, same as HeldTagsBody's verbs. Tag
// changes used to ride the panel's Apply bar, which meant adjusting one
// stack cost a stage, a scroll and an Apply — and Cancel then discarded
// every other pending edit with it. The core column edits (Identity/Turn/
// Goals) are still staged; tags are not. The adjudication desk's
// EffectComposer still stages, and still should: there the whole point is
// that nothing lands until the turn ends.
export default function TagEditor({
  tags,
  held,
  onApplyOps,
  characterId,
  characterName,
}) {
  // A tag just created through the door, shown immediately rather than
  // waiting on the router.refresh() CustomTagDialog already triggers.
  const [extraTags, setExtraTags] = useState([]);
  const [creating, setCreating] = useState(false);
  const [busyTagId, setBusyTagId] = useState(null);
  const [error, setError] = useState(null);

  const allTags = useMemo(() => [...tags, ...extraTags], [tags, extraTags]);
  const categories = useMemo(
    () => [...new Set(allTags.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    [allTags],
  );
  const heldTagIds = useMemo(() => new Set(held.map((h) => h.tagId)), [held]);
  const heldByTagId = useMemo(() => new Map(held.map((h) => [h.tagId, h])), [held]);
  const assignCharacters = characterId ? [{ id: characterId, name: characterName ?? "This character" }] : null;

  // In-progress "how many to grant" for a tag not yet held.
  const [catalogQtyDrafts, setCatalogQtyDrafts] = useState(() => new Map());

  function draftQty(tagId) {
    const n = Number.parseInt(catalogQtyDrafts.get(tagId) ?? "1", 10);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }

  // One gesture, one call, one audit row, one DM. `ops` is an array because
  // a mass-grant carries several, and applyTagOpsInTx already applies a
  // batch in the right order.
  const apply = useCallback(
    async (ops, { tagId = null } = {}) => {
      setError(null);
      setBusyTagId(tagId);
      try {
        const res = await onApplyOps(ops);
        if (!res?.ok) setError(res?.error ?? "Something went wrong.");
        return res;
      } finally {
        setBusyTagId(null);
      }
    },
    [onApplyOps],
  );

  // Mass add: one gesture granting every ticked tag, so still one audit row.
  function grantSelected(tagIds) {
    apply(tagIds.map((tagId) => ({ tagId, op: "add", quantity: 1 })));
  }

  // One line in the catalog. A tag already held is edited in Holds instead —
  // DEV-PANEL.md's own rule is that every action on an existing holding lives
  // there, and a Grant button here meant something quietly different from the
  // stepper sitting above it.
  function renderCatalogActions(tag, { held: isHeld }) {
    if (isHeld) {
      const holding = heldByTagId.get(tag.id);
      return (
        <span className="text-xs text-muted">
          held{holding?.quantity > 1 ? ` ×${holding.quantity}` : ""}
        </span>
      );
    }
    // Only a stackable tag gets a quantity at all. Everything else is a
    // holds-it-or-doesn't flag, and a GM surface doesn't get to override that
    // the way it overrides requiredTag and the budget (TAGS.md §5a).
    const qty = tag.stackable ? draftQty(tag.id) : 1;
    return (
      <>
        {tag.stackable && (
          <QuantityField
            inline
            ariaLabel="How many to grant"
            value={catalogQtyDrafts.get(tag.id) ?? "1"}
            onChange={(v) => setCatalogQtyDrafts((prev) => new Map(prev).set(tag.id, v))}
          />
        )}
        <button
          type="button"
          className="btn-quiet"
          disabled={busyTagId === tag.id}
          onClick={() => apply([{ tagId: tag.id, op: "add", quantity: qty }], { tagId: tag.id })}
        >
          {qty > 1 ? `Grant ×${qty}` : "Grant"}
        </button>
      </>
    );
  }

  return (
    <>
      {error && (
        <span className="form-error text-xs" role="alert">
          {error}
        </span>
      )}

      <TagCatalogBrowser
        tags={allTags}
        heldTagIds={heldTagIds}
        selectable
        onSelectAction={grantSelected}
        selectActionLabel="Grant"
        renderActions={renderCatalogActions}
        onCreateCustom={() => setCreating(true)}
      />

      {creating && (
        <CustomTagDialog
          categories={categories}
          tags={allTags}
          characters={assignCharacters}
          defaultAssignIds={characterId ? [characterId] : []}
          mode="apply"
          onClose={() => setCreating(false)}
          onCreated={(tag) => {
            setExtraTags((prev) => [...prev, tag]);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
