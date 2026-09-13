// Which tags a player may pick in each of the tag-request menus. Each menu
// is one catalog flag (docs/systemdocs/TAGS.md §5), re-checked server-side.

import { holdsRequirement } from "./characterCreation";

// `Tag.tradeable` covers both handing a tag over and lifting it off a body.
export function isTradeable(tag) {
  return Boolean(tag?.tradeable);
}

// The skills that mark a recipe as smithing/crafting work. Every smithing rung
// counts, not just the one Dead Simple actually gates on, so a future 0-turn
// recipe at a higher rung is covered without editing this list.
const DEAD_SIMPLE_SKILL_SLUGS = (slug) => slug === "crafting" || slug.startsWith("smithing");

// There is no "tier" column — Dead Simple is only a comment header in
// docs/tags.yaml — so the tier is recognised by its recipe: 0 turns of work,
// and a smithing or crafting skill gate. That is exactly the craftables
// under the Dead Simple headers today. The one other tag in the catalog with
// `turnsCost: 0` is Frostbite, whose requirement block is a CURE (medical
// skills, the removal direction), so the skill test keeps it out.
//
// `tag.requirementSkills` must be loaded ({ slug }) or this reads false.
export function isDeadSimple(tag) {
  if (tag?.requirementTurns !== 0) return false;
  return (tag.requirementSkills ?? []).some((skill) => DEAD_SIMPLE_SKILL_SLUGS(skill.slug));
}

// How many Dead Simple items a character may make in one turn.
//
// Dead Simple is the bottom rung of the smithing ladder (SMITHING.md §2) and
// the only one that costs 0 turns, so nothing was rationing it: a player could
// file Add Tag requests all turn and walk away with any number of work knives.
// The cap is on UNITS, not requests — the Dead Simple items are stackable and
// one request can carry a quantity of 20 — and it is summed across every
// ADD_TAG request the character has filed this turn.
export const DEAD_SIMPLE_PER_TURN = 4;

// Craft's recipe list: `craftable`, and every recipe skill held — the page
// hands the client the ids it already checked (docs/systemdocs/CRAFTING.md).
// A stackable tag stays on offer once held; an ordinary one drops off.
export function craftableTags(tags, heldTagIds = [], knownRecipeIds = null) {
  const held = new Set(heldTagIds);
  const known = knownRecipeIds ? new Set(knownRecipeIds) : null;
  return tags.filter(
    (tag) => tag.craftable && (!known || known.has(tag.id)) && (tag.stackable || !held.has(tag.id)),
  );
}

// The Craft picker's own verdict: which recipe ids this character may see
// offered at ALL (craftableTags above then narrows further to what's held/
// stackable). Every skill named in `requirementSkills` must be satisfied,
// AND — for a recipe the sync flags non-public — the character must already
// be proven to hold every ingredient at quantity one. Extracted to a pure
// function (character/page.js used to inline this) so the exact production
// logic is directly testable, not a reimplementation of it.
//
// A recipe is "non-public" two ways: an ingredient the sync marks non-`ALL`
// (docs/tags.yaml `catalog:`), or — the recipe's OWN catalogVisibility. The
// second is last-breath's discovery gate (M3 review ruling, recorded in
// planning/medical-pass-plan.md): the recipe may surface in the Craft menu
// ONLY for a character who BOTH satisfies brewing-expert AND holds an
// aberrant-heart. Without checking the recipe's own flag, that conjunction
// would hold only by accident of aberrant-heart's own catalog value —
// reclassify that ingredient as `catalog: all` later (plausible once the
// loot-table pass lands) and the recipe would silently surface for any
// Expert with no heart at all. Tying it to catalogVisibility keeps the
// conjunction intact regardless of what the ingredient's catalog says.
//
// `visibilityBySlug` (ingredient slug -> catalogVisibility) and
// `nonAllGroupSlugs` (group slugs where ANY member is non-`ALL`) are
// resolved by the caller, which needs Prisma to answer them; `characterTags`
// is `{ tag: { slug, group: { slug } } }` rows, the shape `character.tags`
// already comes down in.
export function computeKnownRecipeIds(
  tagCatalog,
  satisfied,
  characterTags,
  { visibilityBySlug = new Map(), nonAllGroupSlugs = new Set() } = {},
) {
  function isNonPublicRecipe(tag) {
    // Miasma's escape hatch (schema.prisma#Tag.recipePublic): a recipe
    // authored `recipePublic: true` is listed regardless of what its
    // ingredient's group currently contains — checked before the group walk
    // below, which is what a `group: items-corpse` recipe would otherwise
    // never clear (three catalog:secret monster corpses always sit in it).
    if (tag.recipePublic) return false;
    if (tag.catalogVisibility !== "ALL") return true;
    return (tag.requirementItems ?? []).some((item) => {
      if (item.kind === "group") return nonAllGroupSlugs.has(item.slug);
      const slugs = item.kind === "anyOf" ? item.slugs : [item.slug];
      return slugs.some((s) => visibilityBySlug.get(s) !== "ALL");
    });
  }
  // Mirrors resolveRecipeItems' HOLD semantics (requestActions.js), at
  // quantity 1 — a hidden recipe only has to prove itself known, not
  // affordable, so this checks "holds one" rather than resolving a spend
  // plan or an anyOf choice.
  function satisfiesIngredientsAtQuantityOne(tag) {
    return (tag.requirementItems ?? []).every((item) => {
      if (item.kind === "group") {
        return characterTags.some((ct) => ct.tag.group?.slug === item.slug);
      }
      const slugs = item.kind === "anyOf" ? item.slugs : [item.slug];
      return characterTags.some((ct) => slugs.includes(ct.tag.slug));
    });
  }
  return tagCatalog
    .filter(
      (t) =>
        t.craftable &&
        (t.requirementSkills ?? []).every((skill) => satisfied.has(skill.id)) &&
        (!isNonPublicRecipe(t) || satisfiesIngredientsAtQuantityOne(t)),
    )
    .map((t) => t.id);
}

// A placement is raised on the ground you stand on rather than landing in a
// pocket (db/lib/structures.js), so the Craft menu drops the ones this ground
// would refuse: nowhere to build at all, a site of the same type already
// going up, or a unique one already standing. Menu hygiene only —
// openBuildSiteImpl refuses the same three cases server-side. Pure, so this
// module stays importable from a client component: `sites` are the structures
// standing here as { typeSlug, status }, resolved in character/page.js.
export function placementOfferedHere(tag, { buildable = false, sites = [], locationSlug = null } = {}) {
  if (!tag?.placement) return true;
  // The per-type site gate, mirroring db/lib/structures.js#canBuildHere's
  // `locations` clause. Menu hygiene only, like the rest of this function —
  // openBuildSiteImpl refuses it server-side too. Fails OPEN on a missing
  // locationSlug so a caller that has not been taught to pass one shows the
  // recipe and lets the server do the refusing, rather than silently hiding
  // every gated structure everywhere.
  const gate = tag.placement.locations;
  const named = Array.isArray(gate) && gate.length > 0;
  if (named && locationSlug && !gate.includes(locationSlug)) return false;
  // `buildable` is the GROUND question and nothing else — canBuildHere with
  // no placement, computed once per page. A type that names this very
  // Location has already passed the stricter server-side test, indoors
  // included, so the blanket flag must not hide it: the Brewery belongs at
  // the Old Cock Inn, and the inn is indoors, so `buildable` is false there
  // for everything and would have hidden the one recipe that works.
  const namedHere = named && Boolean(locationSlug) && gate.includes(locationSlug);
  if (!buildable && !namedHere) return false;
  // The statuses that OCCUPY the ground, mirroring
  // db/lib/structures.js#PRESENT_STATUSES as the same INCLUSION list (kept
  // local so a client bundle never pulls the db module in). Inclusion on
  // both sides means both fail closed on a status neither knows — a new
  // wreck status can never be hidden here while the server accepts it.
  const PRESENT = ["UNDER_CONSTRUCTION", "COMPLETE", "DAMAGED"];
  const sameType = sites.filter((s) => s.typeSlug === tag.slug && PRESENT.includes(s.status));
  if (sameType.some((s) => s.status === "UNDER_CONSTRUCTION")) return false;
  // Tag.placement's own default: absent means unique.
  return tag.placement.unique === false || sameType.length === 0;
}

// The Craft menu's gate: the group's hidden-category check, plus
// `craftable`. Recipe skills are checked separately (satisfiedSkillIds), in
// the page and again in craftRequest. Character creation and /store use
// requirementSatisfied() instead, not this.
export function addRequirementSatisfied(tag, tagsById, heldTagIds) {
  if (!holdsRequirement(tag.group?.requiredTagId, tagsById, heldTagIds)) return false;
  return Boolean(tag.craftable);
}

// Destroy's list: `removable`. Carries the held count onto the returned tag,
// so the menu can cap a quantity field at what the character actually has.
export function destroyableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.removable)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// Smithing and building need Workshop Equipment in reach; ordinary crafting
// needs nothing (docs/systemdocs/SMITHING.md). Read off the recipe's own
// skills rather than a per-tag flag, so a new sword is gated the moment it
// names a smithing skill. Pure and shared, for the reason this whole module
// is: a recipe the dialog says you can make must be one craftRequest accepts.
const WORKSHOP_SKILL_PREFIXES = ["smithing", "builder"];

// A forge is required only when smith's work is UNAVOIDABLE. Naming `crafting`
// at all is the recipe saying "hands are enough" — a sling or a quarterstaff is
// a thing you whittle. What is left needs an anvil: a Broadsword naming only
// `smithing-skilled`, a Cart naming `builder-skilled`.
//
// This used to say every Dead Simple recipe listed `[crafting, smithing]` and
// so none of them needed a forge. That is no longer true. The rung was written
// that way meaning "either skill", but requirementSkills is an AND, so it
// demanded both; splitting it by material fixed the gate and, as a side effect,
// put the five metal Dead Simple recipes (work knife, hatchet, cudgel,
// pitchfork, armored gloves) behind a forge for the first time.
//
// Workshop Equipment itself is exempt, and has to be: it is smith's work that
// names `smithing-skilled`, so gating it on a workshop would mean nobody could
// ever build the first one. You raise your first forge in the open, and it is
// what lets you do the finer work after.
export function needsWorkshop(tag) {
  if (tag?.slug === "workshop-equipment") return false;
  const skills = tag?.requirementSkills ?? [];
  if (skills.some((skill) => skill.slug === "crafting")) return false;
  return skills.some((skill) =>
    WORKSHOP_SKILL_PREFIXES.some((prefix) => skill.slug === prefix || skill.slug?.startsWith(`${prefix}-`)),
  );
}

// Which FAMILY of work a recipe is, read off the same `requirementSkills` the
// forge rule reads. A turn's craft Routine commits to one family and takes
// nothing else (docs/systemdocs/CRAFTING.md §2a): you cannot spend half a
// Routine at the still and half at the anvil.
//
// The family is the skill slug's prefix, so `brewing-basic` and
// `brewing-skilled` are one family and a new rung joins it for free —
// barbed-net's `fundamentalist` sits beside `crafting` and the recipe is
// crafting. A recipe gated outside the five trades takes its first skill
// prefix AS its family (bone-mask is `butcher` work, holy water `blessing`
// work), and a recipe with no skill at all is generic `craft` — EVERY
// recipe is Move-priced by the same arithmetic (Chris 2026-09-06); before
// this, a family-less recipe couldn't spend the Move at all, which is what
// let one Routine hold 99 of a thing.
const CRAFT_FAMILIES = ["brewing", "cooking", "smithing", "builder", "crafting"];

export function craftFamily(tag) {
  // Walked in CRAFT_FAMILIES order, not relation order — requirementSkills
  // comes back from Prisma unordered, and "first matching skill" would make
  // a two-craft-skill recipe's family depend on row order. No such recipe
  // exists today; the first one shouldn't find a nondeterministic seam.
  const prefixes = (tag?.requirementSkills ?? []).map(
    (skill) => (skill?.slug ?? "").split("-")[0],
  );
  const set = new Set(prefixes);
  for (const family of CRAFT_FAMILIES) {
    if (set.has(family)) return family;
  }
  // Sorted for the same determinism reason as the walk above.
  return [...set].filter(Boolean).sort()[0] ?? "craft";
}

// A recipe whose `perTurn` ration must be a hard wall, never a Move spill —
// craftMoveCost() only refuses past the allowance ("capped") for a recipe
// with no family to bill the overflow to (CRAFTING.md §2a's bone-mask
// example); anything else with a real family spills into the Move instead.
// Obol is real smith work by its skill gate — it needs the forge and the
// Skilled rung like anything else on the ladder — but minting a coin isn't
// forging, so it shouldn't be able to eat a smith's Routine the way a
// fifth Broadsword does. This is the one override: not a second meaning
// for craftFamily() itself (still read everywhere else — the obol-spend
// mix-in, the ledger, distilling), just what a *Move price* is allowed to
// see. Extend the set if another recipe ever wants the same shape.
const NEVER_SPILLS_MOVE_SLUGS = new Set(["obol"]);

export function moveFamilyOf(tag) {
  if (NEVER_SPILLS_MOVE_SLUGS.has(tag?.slug)) return null;
  return craftFamily(tag);
}

// `ct.poisonMarker` (M4 fix round): already a stripped, gated boolean by the
// time it reaches here (character/page.js and play/page.js both derive it
// server-side before the sheet crosses into a client component) — never the
// raw poisonedCount/poisonPayload, which this module's callers never see at
// all. Absent on a ct that never carried one (a GM-side caller, say),
// which reads exactly as "not poisoned" — the same as everywhere else.
export function transferableTags(characterTags = []) {
  return characterTags
    .filter((ct) => isTradeable(ct.tag))
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1, poisonMarker: Boolean(ct.poisonMarker) }));
}

// What may go into a crate: anything tradeable, minus crates and mounts. Nesting one
// crate inside another would compound the halving into a free carry exploit,
// and would nest a consumesInto chain arbitrarily deep besides —
// packageItemsRequest refuses it server-side too.
// A runtime crate, from either maker — a Depot shipment or somebody's Package.
// One predicate, because the two places that ask were drifting already.
// `crateContents` is the manifest and it is stripped before a tag crosses to
// the client (character/page.js and play/page.js), so a client-side row proves
// itself a crate with the plain `crate` flag those strips leave behind. Server
// rows still carry the manifest and answer on that.
export function isCrate(tag) {
  return Boolean(tag?.custom && (tag?.crateContents || tag?.crate));
}

// A mount is not cargo. The four MOUNT-slot tags carry no weight on purpose —
// you ride them, you don't carry them — so crateWeight's floor of 1 turned a
// fishing boat into a 1 lb box you could walk indoors. The Depot is the
// deliberate exception: it ships a horse crated like anything else
// (FACTORY.md §5, DEPOT.md §0e).
export function isMount(tag) {
  return tag?.equipSlot === "MOUNT";
}

export function packableTags(characterTags = []) {
  return characterTags
    .filter((ct) => isTradeable(ct.tag) && !isCrate(ct.tag) && !isMount(ct.tag))
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1 }));
}

// The Mulligan Potion is consumable but is never on offer here: drinking it
// means typing a new name into it, which happens in the dialog its own tag
// row opens (TagRail.js -> IdentityDialog.js). Listed among the ordinary
// consumables it would be a bottle spent on nothing. Its own copy of the slug
// rather than an import from db/lib/constants.js, for the reason that file
// gives: this module ships to the client. consumeTagRequestImpl refuses the
// same slug, and that refusal is the actual lock.
const MULLIGAN_SLUG = "mulligan-potion";

// Consuming always takes exactly one unit, so the held count here is shown,
// never a cap. `poisonMarker` (M4 fix round) — the moment of eating is
// exactly where a detector most wants the tell, and it was missing here
// entirely: the poison dialog's own "Which poison?" list and the ordinary
// Consume list both read this.
export function consumableTags(characterTags = []) {
  return characterTags
    .filter((ct) => ct.tag?.consumable && ct.tag.slug !== MULLIGAN_SLUG)
    .map((ct) => ({ ...ct.tag, quantity: ct.quantity ?? 1, poisonMarker: Boolean(ct.poisonMarker) }));
}

// The mount tags — what lets a character cross into a second zone in one
// turn, and how many people the mount seats. Both live in db/lib/mounts.js so
// the bot's travel flow and this page's gates read one set; re-exported here
// because the rest of this module's callers already import from it.
// See DEPOT.md §3.
export { FAST_TRAVEL_SLUGS, fastTravelCapacity } from "@lifeweb/db/lib/mounts";
