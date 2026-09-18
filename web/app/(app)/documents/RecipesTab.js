"use client";

import { Fragment, useMemo, useState } from "react";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import { EmptyRow } from "@/app/components/EmptyState";
import TagChip from "@/app/components/TagChip";
import TagDetailSheet from "@/app/components/TagDetailSheet";
import { needsWorkshop } from "@/lib/tagRequests";
import { recipeRows } from "@/lib/recipeCatalog";

// The recipe book, beside the Tag Catalog on /documents and built out of the
// same rows it is — every craftable tag the reader may see, with its
// `requirement:` block laid out (CRAFTING.md §2). Same table machinery as
// TagCatalogTab, flat rows with Discipline as a column: sorting and the
// filter dropdown answer "what can a smith make" without section headers
// cutting the sort orders apart.
//
// Which recipes reach the browser at all is decided server-side by
// catalogTags() and redactWithheldRecipes() — see web/lib/recipeCatalog.js for
// why a recipe with a secret ingredient goes missing rather than going vague.
// Structures ARE listed — they cost skills, turns and ⬢ like anything else,
// and the Kind column says which are which.
//
// `mySkillIds` is the reader's satisfied-skill set (held tags plus the tiers
// they replace, computed by the page) — null for a GM or a viewer with no
// character, which hides the "my skills" checkbox rather than showing a box
// that can only ever filter to nothing.

const FILTER_DEFS = [
  { key: "discipline", label: "Discipline", value: (r) => r.discipline, minWidth: "11rem" },
  { key: "kind", label: "Kind", value: (r) => r.kind, minWidth: "10rem" },
  { key: "band", label: "Work", value: (r) => r.band, minWidth: "9rem" },
];

const SEARCH_FIELDS = [
  (r) => r.name,
  (r) => r.slug,
  (r) => r.skillLabel,
  (r) => r.ingredientText,
  (r) => r.tag.description,
];

const COLUMNS = 5;

export default function RecipesTab({ tags, mySkillIds = null }) {
  const [viewing, setViewing] = useState(null); // null | {…tag} — the detail sheet
  const [mineOnly, setMineOnly] = useState(false);
  const allRows = useMemo(() => recipeRows(tags), [tags]);

  // Chip lookups: a recipe's skill and ingredient entries carry ids/slugs and
  // denormalized labels; where the reader was actually sent the tag itself,
  // the cell can show the real chip with its hover card instead of the label.
  // A miss (a belief or ingredient outside the reader's catalog) falls back
  // to the plain label, which is exactly what the redaction pass intends.
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const bySlug = useMemo(() => new Map(tags.map((t) => [t.slug, t])), [tags]);

  const skillSet = useMemo(
    () => (Array.isArray(mySkillIds) ? new Set(mySkillIds) : null),
    [mySkillIds],
  );
  // Skills only, on purpose — the checkbox answers "what could I ever make",
  // so a missing ingredient (an errand) doesn't hide a recipe the way a
  // missing trade (a build) would.
  const rows = useMemo(
    () =>
      mineOnly && skillSet
        ? allRows.filter((r) =>
          (r.tag.requirementSkills ?? []).every((s) => skillSet.has(s.id)),
        )
        : allRows,
    [allRows, mineOnly, skillSet],
  );

  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "name", dir: "asc" },
  });

  // `visible`, not `pageRows`: a hundred-odd rows already sit inside one
  // scroll frame, and paging would cut a discipline sort in half.

  return (
    <section className="flex flex-col gap-3">
      <div className="panel flex flex-col gap-3 p-3">
        <FilterBar
          filterDefs={FILTER_DEFS}
          filters={table.filters}
          setFilters={table.setFilters}
          options={table.options}
          query={table.query}
          setQuery={table.setQuery}
          searchLabel="Search recipes"
          searchPlaceholder="Name, skill, or ingredient…"
        />
        {skillSet && (
          <label className="flex w-fit items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
            />
            Only recipes my skills allow
          </label>
        )}
      </div>

      <TableScroll minWidth="860px">
        <thead>
          <tr>
            <SortHeader label="Recipe" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Skill</th>
            <SortHeader label="Work" sortKey="turns" sort={table.sort} onSort={table.toggleSort} />
            <SortHeader label="Cost" sortKey="resources" sort={table.sort} onSort={table.toggleSort} />
            <th scope="col">Ingredients</th>
          </tr>
        </thead>
        <tbody>
          {table.visible.length === 0 && (
            <EmptyRow cols={COLUMNS}>No recipe matches that.</EmptyRow>
          )}
          {table.visible.map((row) => (
            <RecipeRow key={row.id} row={row} byId={byId} bySlug={bySlug} onView={setViewing} />
          ))}
        </tbody>
      </TableScroll>

      <p className="text-sm text-muted">
        {table.total} of {allRows.length} recipes
      </p>

      {viewing && (
        <TagDetailSheet
          tag={viewing}
          tags={tags}
          onOpen={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}

// One skill entry: the real chip where the reader's catalog carries the tag,
// the bare name otherwise. Every listed skill must be held, so entries join
// with "+" (formatTagRequirement's own convention).
function SkillCell({ row, byId }) {
  const skills = row.tag.requirementSkills ?? [];
  if (skills.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {skills.map((skill, i) => {
        const tag = byId.get(skill.id);
        return (
          <Fragment key={skill.id}>
            {i > 0 && <span className="text-muted">+</span>}
            {tag ? <TagChip tag={tag} /> : <span>{skill.name}</span>}
          </Fragment>
        );
      })}
    </span>
  );
}

// One ingredient entry. A plain entry names a tag; an `anyOf` is a
// player-picked choice ("or"); a `group` names no tag at all (a corpse is a
// per-character row minted at death, never in the catalog) and stays text.
function IngredientEntry({ item, bySlug }) {
  if (item?.kind === "group") return <span>{item.label}</span>;
  if (item?.kind === "anyOf") {
    return (
      <span className="flex flex-wrap items-center gap-1">
        {(item.options ?? []).map((opt, i) => {
          const tag = bySlug.get(opt.slug);
          return (
            <Fragment key={opt.slug}>
              {i > 0 && <span className="text-muted">or</span>}
              {tag ? <TagChip tag={tag} /> : <span>{opt.name}</span>}
            </Fragment>
          );
        })}
      </span>
    );
  }
  const tag = bySlug.get(item.slug);
  const many = (item.count ?? 1) > 1 ? <span className="mono text-xs">×{item.count}</span> : null;
  return (
    <span className="inline-flex items-center gap-1">
      {tag ? <TagChip tag={tag} /> : <span>{item.label}</span>}
      {many}
    </span>
  );
}

function RecipeRow({ row, byId, bySlug, onView }) {
  const items = row.tag.requirementItems ?? [];
  return (
    <tr>
      <td>
        {/* Same pairing the Tag Catalog uses: the real chip carries its hover
            card, and because HoverCard's trigger is itself clickable the chip
            can't double as the sheet opener. */}
        <div className="flex items-center gap-2">
          <TagChip tag={row.tag} />
          <button type="button" className="btn-quiet text-xs" onClick={() => onView(row.tag)}>
            Details
          </button>
        </div>
      </td>
      <td className="text-sm">
        <SkillCell row={row} byId={byId} />
        {/* Smith's and builder's work needs a set of tools in reach before any
            of the rest of the recipe matters — same predicate the Craft dialog
            and the server share (SMITHING.md §2a). */}
        {needsWorkshop(row.tag) && (
          <span className="block text-xs text-muted">Needs workshop equipment</span>
        )}
      </td>
      <td className="text-sm">
        {/* A 0-turn recipe lists no work at all — the Move isn't a
            requirement there — so its ration line stands alone. */}
        {row.work}
        {row.ration != null && (
          <span className="block text-xs text-muted">
            {row.rationShared
              ? `Dead Simple: ${row.ration} a turn across all of it`
              : `Up to ${row.ration} a turn`}
          </span>
        )}
        {row.work == null && row.ration == null && (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="mono text-sm">{row.resources > 0 ? `${row.resources} ⬢` : "—"}</td>
      <td className="text-sm">
        {items.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {items.map((item, i) => (
              <Fragment key={item?.slug ?? item?.label ?? i}>
                {i > 0 && <span className="text-muted">·</span>}
                <IngredientEntry item={item} bySlug={bySlug} />
                {item?.keep && (
                  <span className="text-xs text-muted">(not used up)</span>
                )}
              </Fragment>
            ))}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
}
