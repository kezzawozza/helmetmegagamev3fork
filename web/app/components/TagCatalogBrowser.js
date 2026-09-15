"use client";

import { useMemo, useState } from "react";
import { sortForMode, menuCategories, filterTagsByQuery, formatCost, costColor } from "@/lib/characterCreation";
import TagChip from "@/app/components/TagChip";
import InfoIcon from "@/app/components/InfoIcon";

const CUSTOM_TAG_TOOLTIP =
  "Use this for things that would affect adjudications—not just little bracelets or something.";

// The shared catalog-browsing half of the GM tag surface: search (name,
// description, group — whole catalog once you type), category tabs,
// group/chain-aware sorting and bucketing, and an optional multi-select
// mass-action. Extracted from the Dev Panel's TagEditor.js so the same
// power-user browser can drive both a live grant (TagEditor) and a staged
// effect (EffectComposer, /gm/turns) without duplicating the filtering
// logic. Deliberately bypasses every player-facing gate, same as TagEditor —
// this is a GM surface.
//
// Row actions are the one thing callers customize (TagEditor grants live;
// EffectComposer stages an add/remove) — passed as `renderActions(tag, {
// held, staged })`. Everything else (search, tabs, grouping, held/staged
// badges, description disclosure) is shared.
// Not a Tag.category — a tab label that cannot collide with one, since every
// real category comes from docs/tags.yaml's `categories:` map.
const MINTED_TAB = "Minted";

export default function TagCatalogBrowser({
  tags,
  heldTagIds = EMPTY_SET,
  stagedByTagId = EMPTY_MAP,
  selectable = false,
  onSelectAction,
  selectActionLabel = "Add",
  renderActions,
  emptyLabel,
  onCreateCustom,
  // Optional controlled selection. A caller that wants the checked set even
  // when the GM never presses the mass-action button (EffectComposer folds
  // any still-checked tags into the staged ops on submit) passes both of
  // these; every other caller (TagEditor) leaves them undefined and the
  // browser keeps managing its own Set as before.
  selected: controlledSelected,
  onSelectedChange,
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(null);
  const [internalSelected, setInternalSelected] = useState(new Set());
  const isControlled = controlledSelected !== undefined;
  const selected = isControlled ? controlledSelected : internalSelected;
  const setSelected = isControlled ? onSelectedChange : setInternalSelected;

  // Dedupe by id: callers can hand us a catalog merged from more than one
  // source (server props plus a just-created custom tag), and a duplicate
  // entry here renders as two identical rows with one checkbox each.
  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const uniqueTags = useMemo(() => [...tagsById.values()], [tagsById]);
  const sorted = useMemo(() => sortForMode(uniqueTags, "group", tagsById), [uniqueTags, tagsById]);

  // Runtime-minted rows — every note a player wrote, every corpse, crate and
  // photograph — get their OWN tab rather than swelling Items. There can be
  // thousands of them and they are nobody's idea of a catalog, so a GM looking
  // for a longsword should not scroll past a hundred letters to reach it.
  //
  // Bucketed off `Tag.ephemeral`, the column that already means exactly this
  // (/gm/dev's quest picker filters on it for the same reason), NOT off the
  // category string. Until 2026-09-26 the split happened by accident, because
  // the minters wrote a lowercase "items" that sorted beside the real "Items" —
  // useful-looking, but a second spelling of a category is a bug with a side
  // effect, and it made those rows invisible in the /chat Things drawer. This
  // is the same separation done on purpose.
  const { catalog, minted } = useMemo(() => {
    const catalogRows = [];
    const mintedRows = [];
    for (const t of sorted) (t.ephemeral ? mintedRows : catalogRows).push(t);
    return { catalog: catalogRows, minted: mintedRows };
  }, [sorted]);

  const categories = useMemo(
    () => [...menuCategories(catalog), ...(minted.length ? [MINTED_TAB] : [])],
    [catalog, minted],
  );
  const active = categories.includes(category) ? category : categories[0];

  const searching = query.trim().length > 0;

  const visible = useMemo(() => {
    // A search still crosses everything, minted rows included — the tabs are a
    // browsing aid, and somebody who types a letter's title wants that letter.
    const pool = searching
      ? sorted
      : active === MINTED_TAB
        ? minted
        : catalog.filter((t) => t.category === active);
    return filterTagsByQuery(pool, query);
  }, [sorted, catalog, minted, searching, active, query]);

  const groups = useMemo(() => {
    const byKey = new Map();
    for (const tag of visible) {
      const key = tag.group?.name ?? null;
      if (!byKey.has(key)) byKey.set(key, { group: tag.group ?? null, tags: [] });
      byKey.get(key).tags.push(tag);
    }
    const entries = [...byKey.values()];
    entries.sort((a, b) => {
      if (!a.group && !b.group) return 0;
      if (!a.group) return 1;
      if (!b.group) return -1;
      return a.group.name.localeCompare(b.group.name);
    });
    return entries;
  }, [visible]);

  function toggleSelected(tagId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function runSelectAction() {
    onSelectAction?.([...selected]);
    setSelected(new Set());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field flex-1" style={{ minWidth: "16rem" }}>
          <span className="field-label">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, description, or group — searches every category"
          />
        </label>
        {onCreateCustom && (
          <span className="flex items-center gap-1.5">
            <button type="button" className="btn-secondary" onClick={onCreateCustom}>
              + Custom tag
            </button>
            <InfoIcon text={CUSTOM_TAG_TOOLTIP} />
          </span>
        )}
      </div>

      {!searching && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={c === active ? "btn" : "btn-quiet"}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {selectable && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={runSelectAction}>
            {selectActionLabel} {selected.size} selected
          </button>
          <button type="button" className="btn-quiet" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {groups.map(({ group, tags: groupTags }) => (
          <div key={group?.name ?? "__ungrouped"} className="panel flex flex-col p-3">
            {group && (
              <div className="dev-tag-group-head">
                <span
                  className="dev-tag-swatch"
                  style={{ background: group.color ?? "var(--border)" }}
                  aria-hidden
                />
                {group.name}
              </div>
            )}
            <ul className="flex flex-col">
              {groupTags.map((tag) => (
                <BrowserRow
                  key={tag.id}
                  tag={tag}
                  held={heldTagIds.has(tag.id)}
                  staged={stagedByTagId.get(tag.id) ?? null}
                  selectable={selectable}
                  selected={selected.has(tag.id)}
                  onToggleSelected={() => toggleSelected(tag.id)}
                  renderActions={renderActions}
                  matchedDescriptionOnly={
                    searching &&
                    !nameMatches(tag, query) &&
                    !groupNameMatches(tag, query) &&
                    descriptionMatches(tag, query)
                  }
                  showCategoryChip={searching}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-muted">
          {query ? `Nothing matches "${query}".` : (emptyLabel ?? "Nothing in this category.")}
        </p>
      )}
    </div>
  );
}

const EMPTY_SET = new Set();
const EMPTY_MAP = new Map();

function fold(value) {
  return (value ?? "").toString().toLowerCase();
}

function nameMatches(tag, query) {
  return fold(tag.name).includes(fold(query));
}

function groupNameMatches(tag, query) {
  return fold(tag.group?.name).includes(fold(query));
}

function descriptionMatches(tag, query) {
  return fold(tag.description).includes(fold(query));
}

function stagedOutline(staged) {
  return staged === "add"
    ? "1px solid var(--positive)"
    : staged === "remove"
      ? "1px solid var(--accent-text)"
      : staged
        ? "1px dashed var(--accent-text)"
        : undefined;
}

function BrowserRow({
  tag,
  held,
  staged,
  selectable,
  selected,
  onToggleSelected,
  renderActions,
  matchedDescriptionOnly,
  showCategoryChip,
}) {
  return (
    <li className="dev-tag-row" style={{ outline: stagedOutline(staged) }}>
      <span className="flex flex-wrap items-baseline gap-2 flex-1 min-w-0">
        {selectable && (
          <label className="check-hit">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              aria-label={`Select ${tag.name}`}
            />
          </label>
        )}
        {/* TagChip's hover already carries the description (and the
            requirement/fighting/armour rows the old click-to-expand
            disclosure never showed at all) — reading a row no longer takes a
            click. */}
        <TagChip tag={tag} />
        <span className="text-sm" style={{ color: costColor(tag.pointCost) }}>
          {formatCost(tag.pointCost)}
        </span>
        {tag.custom && <span className="chip">custom</span>}
        {held && <span className="chip">held</span>}
        {staged && (
          <span className="text-xs" style={{ color: "var(--accent-text)" }}>
            staged: {staged}
          </span>
        )}
        {showCategoryChip && <span className="chip">{tag.category}</span>}
        {/* Still worth a line: this is WHY the row surfaced under a search
            that didn't match its name, not a copy of what hovering shows. */}
        {matchedDescriptionOnly && <span className="text-xs text-muted">matches description</span>}
      </span>

      <span className="flex flex-wrap items-center gap-2">{renderActions?.(tag, { held, staged })}</span>
    </li>
  );
}
