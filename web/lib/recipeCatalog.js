// The Recipes tab on /documents (RecipesTab.js): every craftable tag's
// `requirement:` block, read as a reference book. What a recipe MEANS is
// CRAFTING.md §2. THE ONE THING IT HIDES is a recipe naming an ingredient
// or a gating SKILL the reader was not sent — printing it would leak that
// the thing exists. A `group:` ingredient names no tag and hides nothing.

import { DEAD_SIMPLE_PER_TURN, isDeadSimple } from "./tagRequests";
import { formatMoveFraction } from "./craftBudget";

function joinWithOr(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export function redactWithheldRecipes(tags, { visibleSlugs = null } = {}) {
  const visible = visibleSlugs ?? new Set(tags.map((t) => t.slug));
  return tags.map((tag) => {
    const skills = tag.requirementSkills ?? [];
    if (tag.craftable && skills.some((s) => s.slug && !visible.has(s.slug))) {
      return {
        ...tag,
        craftable: false,
        requirementSkills: [],
        requirementItems: null,
        requirementTurns: null,
        requirementResources: null,
        requirementPerTurn: null,
        requirementGambit: false,
        recipeWithheld: true,
      };
    }
    const items = Array.isArray(tag.requirementItems) ? tag.requirementItems : null;
    if (!items) return tag;
    let withheld = false;
    let narrowed = false;
    const entries = items.map((entry) => {
      if (entry?.kind === "group") return entry;
      if (entry?.kind === "anyOf") {
        const options = (entry.options ?? []).filter((o) => visible.has(o.slug));
        if (options.length === (entry.options ?? []).length) return entry;
        if (options.length === 0) {
          withheld = true;
          return entry;
        }
        narrowed = true;
        return {
          ...entry,
          slugs: options.map((o) => o.slug),
          options,
          label: joinWithOr(options.map((o) => o.name)),
        };
      }
      if (entry?.slug && !visible.has(entry.slug)) withheld = true;
      return entry;
    });
    if (withheld) return { ...tag, requirementItems: null, ingredientsWithheld: true };
    if (narrowed) return { ...tag, requirementItems: entries };
    return tag;
  });
}

export const NO_SKILL = "No skill";

// Rung dropped; the first SKILL, not requirement (Barbed Net's not a trade).
export function recipeDiscipline(tag) {
  const skills = tag.requirementSkills ?? [];
  const skill = skills.find((s) => s.category === "skills") ?? skills[0];
  if (!skill) return NO_SKILL;
  return skill.name.replace(/\s*\([^()]*\)\s*$/, "").trim() || skill.name;
}

// Null turns is ONE turn, not zero. `ration` mirrors the Move-budget rules
// (CRAFTING.md §2a): perTurn's meaning depends on turns — at 0 it's a
// RATION, at 1 it's the WORK DENOMINATOR from `turnsCost: 1/N`.
export function recipeWork(tag) {
  const turns = tag.requirementTurns ?? 1;
  const per = tag.requirementPerTurn ?? null;
  if (turns === 0 && per != null) {
    return { turns, workDen: null, ration: per, shared: false };
  }
  if (turns === 0 && isDeadSimple(tag)) {
    return { turns, workDen: null, ration: DEAD_SIMPLE_PER_TURN, shared: true };
  }
  if (turns === 1 && per > 1) {
    return { turns, workDen: per, ration: null, shared: false };
  }
  return { turns, workDen: null, ration: null, shared: false };
}

// Shared with the Craft menu. NULL for a 0-turn recipe.
export function workLabel(tag) {
  const { turns, workDen } = recipeWork(tag);
  if (turns === 0) return null;
  if (workDen) return `${formatMoveFraction(1, workDen)} turn`;
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

// No Move at all, this turn's Move, or a project you come back to (CRAFTING.md §3).
export function workBand(turns) {
  if (turns === 0) return "Free";
  return turns === 1 ? "One turn" : "Project";
}

// `tag` rides along whole for TagChip/TagDetailSheet. A Structure still
// lists here — Kind already says "Structures".
export function recipeRows(tags) {
  return tags
    .filter((tag) => tag.craftable && !tag.ingredientsWithheld && !tag.recipeWithheld)
    .map((tag) => {
      const { turns, ration, shared } = recipeWork(tag);
      const work = workLabel(tag);
      const skills = tag.requirementSkills ?? [];
      const ingredients = (tag.requirementItems ?? []).map((item) => {
        if (item.keep) return `${item.label} (not used up)`;
        return (item.count ?? 1) > 1 ? `${item.label} ×${item.count}` : item.label;
      });
      return {
        id: tag.id,
        slug: tag.slug,
        name: tag.name,
        discipline: recipeDiscipline(tag),
        // " + ", not "/": every listed skill must be held (formatTagRequirement).
        skillLabel: skills.map((s) => s.name).join(" + "),
        kind: tag.groupName ?? "—",
        turns,
        work,
        ration,
        rationShared: shared,
        band: workBand(turns),
        resources: tag.requirementResources ?? 0,
        ingredients,
        ingredientText: ingredients.join(", "),
        tag,
      };
    });
}
