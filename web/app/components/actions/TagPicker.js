"use client";

import { useMemo, useState } from "react";
import {
  sortTagsForMenu,
  sortForMode,
  menuCategories,
  formatCost,
  costColor,
  filterTagsByQuery,
  prerequisiteNames,
  hasPrerequisite,
} from "@/lib/characterCreation";
import { addRequirementSatisfied } from "@/lib/tagRequests";
import CheckField from "../CheckField";
import ChipText from "../ChipText";
import { workLabel } from "@/lib/recipeCatalog";

// The tag menu. Craft reuses PointBuy's category-tab layout without
// PointBuy's budget/tier-chain math. `byId`/`heldIds` (Craft menu only) gate
// prerequisites; the other menus just list what's already held.
export default function TagPicker({
  tags,
  selectedId,
  onSelect,
  byId = null,
  heldIds = null,
  emptyLabel = "Nothing available.",
  // (tag) => why this row can't be picked right now, or null. Craft's Move
  // budget uses it; the row stays listed and says why rather than vanishing,
  // because "where did my recipe go" is a worse question than a greyed row.
  blockedReason = null,
}) {
  const [query, setQuery] = useState("");

  // The Craft menu (byId set) sorts chain-aware so tier rungs read in order;
  // held-tag menus keep flat cost-then-name sort.
  const offered = useMemo(
    () => (byId ? sortForMode(tags, "group", byId) : sortTagsForMenu(tags)),
    [tags, byId],
  );
  // Gate first, derive tabs from what survives — a hidden category gets no
  // tab at all. Craft-gate only (recipe skills were already checked server-
  // side — the page hands down `knownRecipeIds`); not requirementSatisfied().
  const unlocked = useMemo(
    () =>
      byId
        ? offered.filter((t) => addRequirementSatisfied(t, byId, heldIds ?? []))
        : offered,
    [offered, byId, heldIds],
  );
  // "Unlocked by your tags": everything shown already passed the gates.
  const [requiresOnly, setRequiresOnly] = useState(false);
  const gated = useMemo(
    () => (byId && requiresOnly ? unlocked.filter(hasPrerequisite) : unlocked),
    [unlocked, byId, requiresOnly],
  );
  const pool = useMemo(() => filterTagsByQuery(gated, query), [gated, query]);
  const categories = useMemo(() => menuCategories(pool), [pool]);
  const [category, setCategory] = useState(null);
  const active = categories.includes(category) ? category : categories[0];
  const visible = pool.filter((t) => t.category === active);

  if (!unlocked.length)
    return <p className="text-sm text-muted">{emptyLabel}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field min-w-40 flex-1">
          <span className="field-label">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, description, or group"
          />
        </label>
        {byId && (
          <CheckField
            checked={requiresOnly}
            onChange={(e) => setRequiresOnly(e.target.checked)}
            className="pb-2"
          >
            Unlocked by your tags
          </CheckField>
        )}
      </div>

      {categories.length > 1 && (
        <div className="tab-bar">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className="tab-item"
              data-active={c === active}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* The pane scrolls itself rather than growing the dialog, so the
          reason field and the Confirm button stay reachable however long
          Items gets — the same treatment PointBuy.js gives its own catalog. */}
      <div
        className="flex flex-col gap-2 overflow-y-auto pr-1"
        style={{ maxHeight: "60vh" }}
      >
        {visible.map((tag) => {
          const isSelected = tag.id === selectedId;
          const blocked = blockedReason?.(tag) ?? null;
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={isSelected}
              disabled={Boolean(blocked)}
              onClick={() => onSelect(isSelected ? null : tag.id)}
              className="select-card panel flex w-full items-start gap-3 p-3 text-left"
              // The category rule, off a --tag-* token (globals.css), same as
              // every other tag face. Width and colour both ride on the
              // attribute now; an inline width here would be one more thing
              // that has to agree with the stylesheet.
              data-tag-category={tag.category ? String(tag.category).toLowerCase() : undefined}
            >
              <span aria-hidden="true">{isSelected ? "◆" : "◇"}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-bold">{tag.name}</span>
                  {tag.pointCost ? (
                    <span
                      className="text-xs"
                      style={{ color: costColor(tag.pointCost) }}
                    >
                      {formatCost(tag.pointCost)} pts
                    </span>
                  ) : null}
                  {tag.group?.name ? (
                    <span className="text-xs text-muted">{tag.group.name}</span>
                  ) : null}
                </span>
                {/* ChipText rather than RichText — the row is a <button>, so a
                    hoverable chip inside it would nest one button in another. */}
                {tag.description && (
                  <ChipText
                    text={tag.description}
                    as="span"
                    className="mt-1 block text-xs text-muted"
                  />
                )}
                {/* The gate that unlocked this row — role/faction kit would
                    otherwise be indistinguishable from the open catalog.
                    Only qualifying viewers ever see the row. */}
                {prerequisiteNames(tag).length > 0 && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--accent-text)" }}
                  >
                    Requires: {prerequisiteNames(tag).join(", ")}
                  </span>
                )}
                {/* The recipe: what it costs and what it needs — work, ⬢,
                    skills, INGREDIENTS — all of it the price tag, not a
                    warning. Everything listed already passed the skill check
                    server-side. workLabel is the same words the Recipes tab
                    prints, so the two surfaces cannot disagree. Craft menu
                    only. */}
                {byId && tag.craftable && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {[
                      // Null for a 0-turn recipe — no Move requirement, so
                      // none is listed.
                      ...(workLabel(tag) ? [workLabel(tag)] : []),
                      `${tag.requirementResources ?? 0} ⬢`,
                      ...((tag.requirementSkills ?? []).length
                        ? [tag.requirementSkills.map((s) => s.name).join(", ")]
                        : []),
                      ...(() => {
                        const items = tag.requirementItems ?? [];
                        const spends = items
                          .filter((i) => !i.keep)
                          .map((i) => ((i.count ?? 1) > 1 ? `${i.label} ×${i.count}` : i.label));
                        const keeps = items.filter((i) => i.keep).map((i) => i.label);
                        return [
                          ...(spends.length ? [`uses ${spends.join(" + ")}`] : []),
                          ...(keeps.length ? [`needs ${keeps.join(" + ")} to hand`] : []),
                        ];
                      })(),
                    ].join(" · ")}{" "}
                  </span>
                )}
                {/* A placement is raised on the ground rather than handed
                    over, so the row says where it ends up before the recipe
                    line's turns and ⬢ are read as a pocketable thing. */}
                {byId && tag.placement && (
                  <span className="mt-1 block text-xs text-muted">
                    Built where you stand
                  </span>
                )}
                {blocked && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: "var(--accent-text)" }}
                  >
                    {blocked}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-muted">
            {query
              ? "Nothing matches that."
              : "Nothing available in this category."}
          </p>
        )}
      </div>
    </div>
  );
}
