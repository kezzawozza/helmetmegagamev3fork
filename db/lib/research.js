// Pure classification for the Research skill (Scholastic-only, docs/systemdocs/CRAFTING.md §2b). No prisma except loadResearchCatalog.

const RESEARCH_TAG_SLUG = "research";
const CATHEDRAL_LOCATION_SLUG = "cathedral";

// Machine-marker idiom (db/lib/lessonPass.js), never rendered (MoveDesk.js), refused on a player Edit (moves.js).
// `(?:^|\n)`: stagedPush.js APPENDS "auto:silent_close" via newline join, so matching must work mid-string too.
const RESEARCH_MARKER_RE = /(?:^|\n)auto:research:([a-z0-9-]+)/;

function researchMarker(slug) {
  return `auto:research:${slug}`;
}

// One requirementItems entry against one ingredient tag; `tagLike` only needs { slug, group?: { slug } }.
function entryMatches(entry, tagLike) {
  if (entry.kind === "group") return entry.slug === tagLike.group?.slug;
  const slugs = entry.kind === "anyOf" ? entry.slugs : [entry.slug];
  return slugs.includes(tagLike.slug);
}

function isCraftableIngredientOf(recipe, tagLike) {
  return (
    recipe.craftable === true &&
    (recipe.requirementItems ?? []).some((entry) => entryMatches(entry, tagLike))
  );
}

// The picker's shortlist (CRAFTING.md §2b): every held tag that's an ingredient of any craftable recipe.
function researchableHeld(characterTags, catalogTags) {
  const held = new Map();
  for (const ct of characterTags ?? []) {
    if (!ct?.tag || held.has(ct.tag.slug)) continue;
    const isIngredient = (catalogTags ?? []).some((recipe) =>
      isCraftableIngredientOf(recipe, ct.tag),
    );
    if (isIngredient) held.set(ct.tag.slug, ct);
  }
  return [...held.values()].sort((a, b) => a.tag.name.localeCompare(b.tag.name));
}

// CRAFTING.md §2b: a "secret recipe" is a craftable whose PRODUCT is
// `catalog: gm` — never `catalog: secret` and never `catalog: all`.
function secretRecipesFor(ingredientTag, catalogTags) {
  return (catalogTags ?? []).filter(
    (recipe) =>
      recipe.catalogVisibility === "GM" &&
      isCraftableIngredientOf(recipe, ingredientTag),
  );
}

// `secrets` is the pool AFTER the caller drops what's already been dealt.
// paper: total>=6 and an undealt secret remains; unlikely: none undealt but total>=4; else nothing.
function researchOutcome({ total, secrets }) {
  if (total >= 6 && secrets.length > 0) return "paper";
  if (secrets.length === 0 && total >= 4) return "unlikely";
  return "nothing";
}

async function loadResearchCatalog(prisma) {
  return prisma.tag.findMany({
    where: { craftable: true },
    // `craftable` must be selected too: a Prisma select returns nothing not asked for.
    select: {
      id: true,
      slug: true,
      name: true,
      craftable: true,
      catalogVisibility: true,
      description: true,
      requirementItems: true,
      requirementSkills: { select: { name: true } },
      requirementTurns: true,
      requirementResources: true,
      requirementGambit: true,
      group: { select: { slug: true } },
    },
  });
}

// A description's `{tag:slug}` tokens (web/app/components/richTokens.js has the grammar).
const TAG_TOKEN_RE = /\{tag:([A-Za-z0-9_-]+)\}/g;

// The note a successful Research mints; markdown, tokens flattened via `nameOf(slug)`.
function researchPaperText(recipe, nameOf = () => null) {
  const description = (recipe.description ?? "")
    .replace(TAG_TOKEN_RE, (raw, slug) => nameOf(slug) ?? raw)
    .trim();
  const costLines = [];
  if (recipe.requirementTurns) {
    costLines.push(`${recipe.requirementTurns} turn${recipe.requirementTurns === 1 ? "" : "s"}`);
  }
  if (recipe.requirementResources) costLines.push(`${recipe.requirementResources} ⬢`);
  for (const skill of recipe.requirementSkills ?? []) if (skill?.name) costLines.push(skill.name);
  if (recipe.requirementGambit) costLines.push("Gambit");
  // Spent vs. kept still differ (formatTagRequirement's "uses"/"needs to hand"), as a suffix here.
  const itemLines = (recipe.requirementItems ?? []).map((item) => {
    const count = (item.count ?? 1) > 1 ? ` ×${item.count}` : "";
    return `${item.label}${count}${item.keep ? " (kept)" : ""}`;
  });
  const blocks = [recipe.name];
  if (description) blocks.push(`"${description}"`);
  if (costLines.length) blocks.push(costLines.join("  \n"));
  if (itemLines.length) blocks.push(["\\- Requires -", ...itemLines].join("  \n"));
  return blocks.join("\n\n");
}

// Every earlier attempt on the SAME ingredient adds +1 to this total. Counts `research_filed`
// AuditLog rows, restarted at the last `research_revealed`; excludes the current turn's own filing.
function familiarityBonus({ filed = [], revealed = [], ingredientSlug, currentTurnId }) {
  const forSlug = (row) => row?.details?.ingredientSlug === ingredientSlug;
  const lastReveal = revealed
    .filter(forSlug)
    .reduce((latest, row) => (row.createdAt > (latest ?? 0) ? row.createdAt : latest), null);
  return filed.filter(
    (row) => forSlug(row) && row.turnId !== currentTurnId && (!lastReveal || row.createdAt > lastReveal),
  ).length;
}

module.exports = {
  RESEARCH_TAG_SLUG,
  CATHEDRAL_LOCATION_SLUG,
  RESEARCH_MARKER_RE,
  researchMarker,
  researchableHeld,
  secretRecipesFor,
  researchOutcome,
  familiarityBonus,
  loadResearchCatalog,
  TAG_TOKEN_RE,
  researchPaperText,
};
