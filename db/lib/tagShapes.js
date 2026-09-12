// Shared shape helpers for the tag columns that hold JSON rather than a
// scalar, so the two surfaces that author them enforce one rule set.
//
// There are two authoring surfaces now: docs/tags.yaml through
// db/lib/syncTags.js, and the GM tag form through
// web/app/(app)/gm/dev/tags/actions.js. These lived inline in syncTags.js
// while the YAML was the only door. Leaving them there and re-deriving the
// rules in the web action would give GMs a form that happily accepts a shape
// the next `npm run db:sync-tags` would reject — the failure would surface
// hours later, in a script, against a row nobody remembers writing.
//
// The messages take a `label` so each caller can name its own source: the
// sync says `docs/tags.yaml: tag "festering" …` and the GM form says
// something a GM reading a modal can act on.

// A chain entry (expiresInto or removesInto) is either a bare slug
// ("festering") or an even random pick between several
// ({ oneOf: ["missing-leg", "missing-arm"] }). Both normalise to
// { oneOf: [...] } here — a bare slug is simply a pick of one — so
// validation, the stored Json, and the passes that apply them all handle one
// shape instead of two. Null stays null: most tags don't turn into anything.
function normalizeTagChain(field, entries, label) {
  if (entries == null) return null;
  if (!Array.isArray(entries)) {
    throw new Error(`${label}: ${field} must be a list`);
  }
  return entries.map((entry) => {
    if (typeof entry === "string") return { oneOf: [entry] };
    if (!Array.isArray(entry?.oneOf) || entry.oneOf.length === 0) {
      throw new Error(`${label}: a ${field} entry is neither a slug nor a non-empty { oneOf: [...] }`);
    }
    return { oneOf: [...entry.oneOf] };
  });
}

// `dead` is a reserved token in an expiry chain, not a tag — there is no such
// row in the catalog, because death is a Character.status rather than
// something you hold. It means "this one kills at its own close, with no
// Dying turn in between", and db/lib/tagExpiryPass.js applies it by stamping
// the Dying grant for THIS turn instead of the next one, so
// db/lib/dyingDeathPass.js does the actual killing exactly as it always has.
// Three wounds carry it: arterial-bleed, phrygian-toxin and crucified.
const DEAD_TOKEN = "dead";

// The two rules every chain shares: each slug exists, and a tag may not list
// itself. The self check's failure mode differs per field, so each validator
// below names its own. `allowDead` opens the reserved token to expiresInto and
// nothing else — curing a wound must never be able to kill, so removesInto
// leaves it closed and the unknown-tag error below catches it.
function validateChainSlugs(field, normalized, { selfSlug, knownSlugs, label, selfProblem, allowDead = false }) {
  for (const { oneOf } of normalized ?? []) {
    for (const slug of oneOf) {
      if (slug === DEAD_TOKEN && allowDead) continue;
      if (!knownSlugs.has(slug)) {
        throw new Error(`${label}: tag "${selfSlug}" ${field} references unknown tag "${slug}"`);
      }
      if (slug === selfSlug) {
        throw new Error(`${label}: tag "${selfSlug}" ${field} itself — ${selfProblem}`);
      }
    }
  }
}

function normalizeExpiresInto(entries, label = "docs/tags.yaml") {
  return normalizeTagChain("expiresInto", entries, label);
}

// The three rules an expiry chain has to satisfy. Each one is a silent no-op
// rather than an error if it slips through, which is exactly why they are
// checked up front on both doors.
//
//   normalized   the output of normalizeExpiresInto, or null
//   selfSlug     the tag being authored, which may not appear in its own chain
//   knownSlugs   a Set of every slug that exists
//   durationTurns the tag's own defaultDurationTurns
function validateExpiresInto(normalized, { selfSlug, knownSlugs, durationTurns, label = "docs/tags.yaml" }) {
  // The self check: the grant happens one statement before the sweep that
  // deletes the expired row, and the sweep matches on tag id — so a tag that
  // expires into itself would be re-granted and then immediately deleted,
  // doing nothing at all. Recurring conditions are written as a two-tag loop
  // instead (migraine <-> no-migraine).
  validateChainSlugs("expiresInto", normalized, {
    selfSlug,
    knownSlugs,
    label,
    selfProblem: "the sweep would delete the fresh grant. Use a two-tag loop instead.",
    allowDead: true,
  });
  if (normalized && !(durationTurns > 0)) {
    throw new Error(`${label}: tag "${selfSlug}" sets expiresInto but has no durationTurns — nothing would ever fire it`);
  }
  // `dead` may be the whole chain or one side of a coin flip, but it may not
  // ride alongside another entry: entries are all granted at once, and there
  // is nobody left to hold the other one.
  if ((normalized?.length ?? 0) > 1 && normalized.some(({ oneOf }) => oneOf.includes(DEAD_TOKEN))) {
    throw new Error(
      `${label}: tag "${selfSlug}" expiresInto lists "${DEAD_TOKEN}" beside another entry — the holder is dead, so nothing else could land`,
    );
  }
}

// escalatesInto — the rung ABOVE this tag on a ladder (docs/tags.yaml's
// header, docs/systemdocs/BREWING.md). Consuming something that grants a tag
// you already hold clears the held one and gives you this instead, which is
// the only reason a second drink does anything at all.
//
// One bare slug, not the { oneOf } shape expiresInto uses: a ladder has
// exactly one next rung, and a random one would make "one more drink"
// impossible to plan around.
function validateEscalatesInto(value, { selfSlug, knownSlugs, label = "docs/tags.yaml" }) {
  if (value == null) return;
  if (typeof value !== "string" || !value) {
    throw new Error(`${label}: tag "${selfSlug}" escalatesInto must be a single slug`);
  }
  if (!knownSlugs.has(value)) {
    throw new Error(`${label}: tag "${selfSlug}" escalatesInto references unknown tag "${value}"`);
  }
  if (value === selfSlug) {
    throw new Error(`${label}: tag "${selfSlug}" escalatesInto itself — drinking again would change nothing`);
  }
}

// cures — the medical pass's item-cure list (TAGS.md §5c). A flat list of
// health-tag slugs, deliberately NOT the { oneOf } chain shape expiresInto
// and removesInto use: an item cures everything in its list that the target
// happens to hold, not a random pick between them.
function normalizeCures(entries, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries) || entries.some((s) => typeof s !== "string" || !s)) {
    throw new Error(`${label}: cures must be a list of tag slugs`);
  }
  if (entries.length === 0) return null;
  return [...new Set(entries)];
}

// Every cured slug has to exist and be category Health, and the carrier has
// to be consumable — nothing else ever reaches the Consume door. Deliberately
// NOT checked against `healable`: Forgiveness cures the untreatable
// Shell Shocked, and that gap is the point (medicine can do what no medic
// can).
function validateCures(normalized, { selfSlug, knownSlugs, categoryBySlug, consumable, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  if (!consumable) {
    throw new Error(`${label}: tag "${selfSlug}" declares cures but is not consumable — nothing would ever apply it`);
  }
  for (const slug of normalized) {
    if (!knownSlugs.has(slug)) {
      throw new Error(`${label}: tag "${selfSlug}" cures references unknown tag "${slug}"`);
    }
    if (categoryBySlug?.get(slug) !== "Health") {
      throw new Error(`${label}: tag "${selfSlug}" cures "${slug}", which isn't a Health tag`);
    }
  }
}

// curesInto — the per-item aftermath override sidecar (prosthetics: a
// crafted peg-leg cures missing-leg into peg-leg, a cybernetic leg leaves
// nothing). A mapping, not a chain: { <cured-slug>: <aftermath-slug> }.
function normalizeCuresInto(raw, label = "docs/tags.yaml") {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: curesInto must be a mapping of cured slug -> aftermath slug`);
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) return null;
  for (const [key, value] of entries) {
    if (!key || typeof value !== "string" || !value) {
      throw new Error(`${label}: curesInto entries must map a cured slug to an aftermath slug`);
    }
  }
  return { ...raw };
}

// Keys must be a subset of this tag's own `cures` — an override for a slug
// the item doesn't even cure would never fire. Values are any catalog slug,
// same as removesInto (a prosthetic aftermath doesn't have to be Health).
function validateCuresInto(normalized, { selfSlug, knownSlugs, cures, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  const curesSet = new Set(cures ?? []);
  for (const [curedSlug, aftermathSlug] of Object.entries(normalized)) {
    if (!curesSet.has(curedSlug)) {
      throw new Error(`${label}: tag "${selfSlug}" curesInto key "${curedSlug}" isn't in its own cures list`);
    }
    if (!knownSlugs.has(aftermathSlug)) {
      throw new Error(`${label}: tag "${selfSlug}" curesInto references unknown tag "${aftermathSlug}"`);
    }
  }
}

// administerSkill — a single catalog slug, the same convention
// escalatesInto uses rather than a relation. Existence only; it names a
// skill tag but doesn't have to be one of requirementSkills' rows.
function validateAdministerSkill(value, { knownSlugs, selfSlug, label = "docs/tags.yaml" }) {
  if (value == null) return;
  if (typeof value !== "string" || !value) {
    throw new Error(`${label}: tag "${selfSlug}" administerSkill must be a single tag slug`);
  }
  if (!knownSlugs.has(value)) {
    throw new Error(`${label}: tag "${selfSlug}" administerSkill references unknown tag "${value}"`);
  }
}

// resists — Iron Constitution's eventual sidecar (a later medical-pass
// milestone). A flat list of slugs, same shape as cures; existence is the
// only rule.
function normalizeResists(entries, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries) || entries.some((s) => typeof s !== "string" || !s)) {
    throw new Error(`${label}: resists must be a list of tag slugs`);
  }
  if (entries.length === 0) return null;
  return [...new Set(entries)];
}

function validateResists(normalized, { selfSlug, knownSlugs, label = "docs/tags.yaml" }) {
  for (const slug of normalized ?? []) {
    if (!knownSlugs.has(slug)) {
      throw new Error(`${label}: tag "${selfSlug}" resists references unknown tag "${slug}"`);
    }
  }
}

// The whole-document half of the check. A per-tag rule can catch a tag
// pointing at itself, but not tipsy -> wasted -> tipsy, and the resolver
// walks this chain in a loop — so a cycle there would hang the request rather
// than fail it. Cheap to prove up front, so it is proved up front.
//
// `bySlug` is a Map of slug -> escalatesInto (or null).
function validateEscalationChains(bySlug, label = "docs/tags.yaml") {
  for (const start of bySlug.keys()) {
    const seen = new Set([start]);
    let at = bySlug.get(start);
    while (at) {
      if (seen.has(at)) {
        throw new Error(
          `${label}: escalatesInto loops through "${at}" — a ladder has to end, or a drink never stops escalating`,
        );
      }
      seen.add(at);
      at = bySlug.get(at) ?? null;
    }
  }
}

// removesInto — what a tag turns into when it leaves the sheet through a
// player-driven removal (the Remove Tag request, or a Heal). Same entry
// shape as expiresInto; no duration requirement, since the removal itself is
// what fires it rather than any clock. The aftermath's own
// defaultDurationTurns decides how long it lingers.
function normalizeRemovesInto(entries, label = "docs/tags.yaml") {
  return normalizeTagChain("removesInto", entries, label);
}

function validateRemovesInto(normalized, { selfSlug, knownSlugs, label = "docs/tags.yaml" }) {
  // The self check here: re-granting the tag the player just paid to remove
  // would make removal a no-op with a bill attached.
  validateChainSlugs("removesInto", normalized, {
    selfSlug,
    knownSlugs,
    label,
    selfProblem: "removing it would grant it right back.",
  });
}

// Rolls a stored (normalized) chain into concrete slugs — an even pick per
// entry, a bare slug having normalised to a one-element oneOf. The same roll
// db/lib/tagExpiryPass.js makes inline; exposed here for the removal paths.
function rollTagChain(normalized) {
  const slugs = [];
  for (const entry of Array.isArray(normalized) ? normalized : []) {
    const choices = entry?.oneOf ?? [];
    if (!choices.length) continue;
    slugs.push(choices[Math.floor(Math.random() * choices.length)]);
  }
  return slugs;
}

// requirement.items — the INGREDIENT half of a recipe. Four entry shapes:
//
//     items: [cave-fungus]                 a specific tag, SPENT
//     items: [{ group: items-corpse }]     any tag in a group, KEPT
//     items: [{ anyOf: [tea, sweets] }]    the player picks one, SPENT
//     items: [{ customOf: lavish-meal }]   any mint of that recipe, SPENT
//
// The group form is not a convenience — it is the only thing that can work for
// Miasma. A person's corpse tag is written at death (db/lib/corpseMint.js) and
// never appears in docs/tags.yaml, so no authored slug could ever name one.
// That is also why the stored column is Json rather than a Tag[] relation.
//
// customOf exists for the same reason, on a different axis: a Lavish Meal
// almost never IS the authored `lavish-meal` row — mintCustomCraft clones it
// into a fresh ephemeral Tag with a random slug the instant a cook adds an
// ingredient (COOKING.md), and `customOfSlug` on that clone is the only field
// that still says which recipe it came from. A `group:` can't reach it
// spendably (groups are always kept, and items-food is far too wide anyway);
// `anyOf:` can't reach it at all, since there is no fixed slug list to name.
//
// CONSUMED OR KEPT, and the default differs by shape. A slug (or an `anyOf`
// pick) is SPENT — `quantity` units per craft, scaled the same way ⬢ is. A
// GROUP entry is KEPT: a body has its own lifecycle, and "any member of a
// group" has no single stack to decrement, so `keep: false` on a group is
// refused rather than guessed at. `keep: true` on a slug turns it back into
// the old hold-check (dreamers-draught's brain used to be one).
//
// `label` on each normalized entry is DENORMALIZED on purpose.
// formatTagRequirement() is pure and synchronous and is called from four
// surfaces with four different selects; resolving a group's name at render
// time would mean widening every one of them and giving the bot an extra
// query. The sync rewrites the label every run, which is the same freshness
// contract every other denormalized field in the catalog has. An `anyOf`
// entry carries `options: [{ slug, name }]` for the same reason: the Craft
// dialog's picker needs the members' names and has only the recipe row.
function joinWithOr(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// requirement.turnsCost carries the WORK one unit takes: an integer number
// of Moves, or a `1/N` fraction — a brew that is a third of a turn's work is
// `turnsCost: 1/3`, and three of them fill a Routine (Chris 2026-09-06, the
// work-arithmetic concept: quantity is limited by work, never by a separate
// cap). Internally a fraction stores as requirementTurns: 1 +
// requirementPerTurn: N — the engine's existing share encoding — so this is
// an authoring surface, not a schema change. `perTurn:` itself is ONLY legal
// on a 0-turn recipe, where it is a RATION (a hard daily cap below the Dead
// Simple pool's 4); writing it on anything that costs a Move is refused,
// because that is the double-duty this function exists to end.
function normalizeTurnsCost(requirement, { slug, healable = false }, label = "docs/tags.yaml") {
  const raw = requirement?.turnsCost;
  // A healable tag's turnsCost has to be authored explicitly (review fix,
  // round 3, closing an authoring trap the M2 Move economy opened):
  // countsAgainstHealCap (web/lib/healRequests.js) reads a MISSING
  // turnsCost as 0 (free, inside the day's pool), craftMoveCost
  // (web/lib/craftBudget.js) reads the same missing value as 1 (a whole
  // Move) — a healable tag authored with no turnsCost at all would silently
  // split what the Heal dialog shows from what the server actually bills.
  // validateHealableRequirement (below) is this same rule for the GM tag
  // form's door, which has no fraction picker and so checks its own
  // already-parsed requirementTurns instead of this raw field.
  if (raw == null && healable) {
    throw new Error(
      `${label}: tag "${slug}" is healable but requirement.turnsCost is missing — author it explicitly (0, a whole number, or "1/N", TAGS.md §5c)`,
    );
  }
  const perTurn = requirement?.perTurn ?? null;
  let turns = null;
  let workDen = null;
  if (raw == null) {
    turns = null;
  } else if (Number.isInteger(raw) && raw >= 0) {
    turns = raw;
  } else if (typeof raw === "string" && /^1\/[2-9][0-9]*$/.test(raw.trim())) {
    turns = 1;
    workDen = Number(raw.trim().slice(2));
  } else {
    throw new Error(
      `${label}: tag "${slug}" requirement.turnsCost must be a whole number of Moves or a "1/N" fraction — got ${JSON.stringify(raw)}`,
    );
  }
  if (perTurn != null) {
    if (!Number.isInteger(perTurn) || perTurn < 1) {
      throw new Error(`${label}: tag "${slug}" requirement.perTurn must be a positive integer`);
    }
    if ((turns ?? 1) !== 0) {
      throw new Error(
        `${label}: tag "${slug}" sets perTurn on a recipe that costs a Move — perTurn is a 0-turn ration; write the work as turnsCost: 1/${perTurn} instead`,
      );
    }
  }
  return {
    requirementTurns: turns,
    requirementPerTurn: workDen ?? perTurn,
  };
}

// The GM tag form's counterpart to normalizeTurnsCost's healable check above
// (review fix, round 3): same rule — a healable tag needs turnsCost
// authored, never inferred — read off the form's own already-parsed
// `requirementTurns` instead of a raw YAML `turnsCost` string, since the
// form has no fraction picker to author one with yet (db/lib/syncTags.js's
// `normalizeTurnsCost` is still the only door onto a fractional cure).
function validateHealableRequirement(requirementTurns, { healable, selfSlug, label = "docs/tags.yaml" }) {
  if (healable && requirementTurns == null) {
    throw new Error(
      `${label}: tag "${selfSlug}" is healable but requirementTurns is blank — author it explicitly (0 or a whole number of turns)`,
    );
  }
}

function normalizeRequirementItems(entries, { tagNameBySlug = null, groupNameBySlug = null } = {}, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries)) throw new Error(`${label}: requirement.items must be a list`);
  if (entries.length === 0) return null;
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return { kind: "tag", slug: entry, label: tagNameBySlug?.get(entry) ?? entry, keep: false };
    }
    const hasTag = typeof entry?.tag === "string";
    const hasGroup = typeof entry?.group === "string";
    const hasAnyOf = entry?.anyOf != null;
    const hasCustomOf = typeof entry?.customOf === "string";
    if ([hasTag, hasGroup, hasAnyOf, hasCustomOf].filter(Boolean).length !== 1) {
      throw new Error(`${label}: a requirement.items entry needs exactly one of \`tag:\`, \`group:\`, \`anyOf:\` or \`customOf:\``);
    }
    if (entry.keep != null && typeof entry.keep !== "boolean") {
      throw new Error(`${label}: a requirement.items \`keep:\` must be a boolean`);
    }
    // How many units of THIS ingredient one craft takes, on top of the craft
    // quantity — a blank book is ten sheets, and three of them are thirty.
    // Carried only when it isn't 1: every reader writes `count ?? 1`, so
    // storing the default would fatten each recipe's Json for nothing.
    //
    // Refused on a `group:` and alongside `keep: true` for the same reason
    // `keep: false` is refused on a group: both are hold-checks with no single
    // stack to decrement, so a count on one would silently mean nothing.
    const count = entry.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`${label}: a requirement.items \`count:\` must be a whole number of 1 or more`);
    }
    if (count !== 1 && (hasGroup || entry.keep === true)) {
      throw new Error(
        `${label}: a requirement.items \`count:\` only applies to an ingredient that is SPENT — a kept entry names no stack to draw from`,
      );
    }
    const countField = count === 1 ? {} : { count };
    if (hasTag) {
      return {
        kind: "tag",
        slug: entry.tag,
        label: entry.as ?? tagNameBySlug?.get(entry.tag) ?? entry.tag,
        keep: entry.keep === true,
        ...countField,
      };
    }
    if (hasAnyOf) {
      if (!Array.isArray(entry.anyOf) || entry.anyOf.length < 2 || entry.anyOf.some((s) => typeof s !== "string")) {
        throw new Error(`${label}: a requirement.items \`anyOf:\` must list 2 or more tag slugs`);
      }
      const slugs = [...entry.anyOf];
      const options = slugs.map((slug) => ({ slug, name: tagNameBySlug?.get(slug) ?? slug }));
      return {
        kind: "anyOf",
        slugs,
        options,
        label: entry.as ?? joinWithOr(options.map((o) => o.name)),
        keep: entry.keep === true,
        ...countField,
      };
    }
    if (hasCustomOf) {
      return {
        kind: "customOf",
        slug: entry.customOf,
        label: entry.as ?? tagNameBySlug?.get(entry.customOf) ?? entry.customOf,
        keep: entry.keep === true,
        ...countField,
      };
    }
    // A group is HELD, never spent: there is no one stack to take it out of.
    if (entry.keep === false) {
      throw new Error(
        `${label}: a requirement.items \`group:\` entry cannot set \`keep: false\` — a group names no single stack to spend`,
      );
    }
    // "Corpses" -> "a corpse". Graceless for some group names, which is what
    // the `as:` override is there for.
    const name = groupNameBySlug?.get(entry.group) ?? entry.group;
    const derived = name.replace(/s$/i, "").toLowerCase();
    return { kind: "group", slug: entry.group, label: entry.as ?? `a ${derived}`, keep: true };
  });
}

function validateRequirementItems(normalized, { selfSlug, tagSlugs, groupSlugs, craftable, placement = null, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  const seen = new Set();
  let pickers = 0;
  for (const entry of normalized) {
    const slugs = entry.kind === "anyOf" ? entry.slugs : [entry.slug];
    const known = entry.kind === "group" ? groupSlugs : tagSlugs;
    for (const slug of slugs) {
      if (!known?.has(slug)) {
        throw new Error(`${label}: tag "${selfSlug}" references unknown requirement item ${entry.kind} "${slug}"`);
      }
    }
    if (entry.kind === "anyOf" && new Set(slugs).size !== slugs.length) {
      throw new Error(`${label}: tag "${selfSlug}" lists the same slug twice inside one anyOf`);
    }
    if (entry.kind === "anyOf") pickers += 1;
    const key = entry.kind === "anyOf" ? `anyOf:${[...slugs].sort().join("|")}` : `${entry.kind}:${entry.slug}`;
    if (seen.has(key)) {
      throw new Error(`${label}: tag "${selfSlug}" lists requirement item "${slugs.join("/")}" twice`);
    }
    seen.add(key);
  }
  // ONE picker per recipe. The Craft dialog posts a single `ingredientChoice`,
  // so a second anyOf would have no way to be answered — refuse it here rather
  // than ship a recipe nobody can file.
  if (pickers > 1) {
    throw new Error(`${label}: tag "${selfSlug}" has ${pickers} anyOf ingredients — the Craft dialog posts one choice`);
  }
  // Not pedantry. The only enforcement point is the Craft path, so an `items`
  // block on anything else would sit in the catalog looking enforced and do
  // nothing — which is the exact failure mode this field exists to end.
  if (!craftable) {
    throw new Error(`${label}: tag "${selfSlug}" declares requirement.items but is not craftable — nothing would ever check it`);
  }
  // A `placement:` recipe is raised by a CREW over several turns
  // (openBuildSiteImpl / joinBuildSite), and nothing on that path spends an
  // ingredient — whose stack would it come out of, on turn three, when a
  // second builder lends the Move? Refusing at sync is cheaper than inventing
  // crew-turn ingredient semantics nobody asked for.
  if (placement) {
    throw new Error(
      `${label}: tag "${selfSlug}" declares requirement.items and placement — a build site never spends an ingredient`,
    );
  }
}


// The `laborBonus:` block — what a tool adds to one kind of Laboring
// (docs/systemdocs/LABORING.md). Normalised here rather than trusted straight
// from YAML because a typo in `kind` would silently make a tool worthless, and
// the symptom (a bow that pays nothing) looks like a rules question rather than
// a data bug.
//
// { kind, amount, equipped, requiresTag } or null. `equipped` defaults TRUE —
// nearly every tool is something you carry, and the two that aren't say so.
const LABOR_BONUS_KINDS = new Set(["hunting", "farming", "fishing", "prospecting"]);

function normalizeLaborBonus(entry, label = "docs/tags.yaml") {
  if (entry == null) return null;
  if (typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${label}: laborBonus must be a mapping`);
  }
  const kind = String(entry.kind ?? "").toLowerCase();
  if (!LABOR_BONUS_KINDS.has(kind)) {
    throw new Error(`${label}: laborBonus.kind must be one of ${[...LABOR_BONUS_KINDS].join(", ")}`);
  }
  const amount = Number(entry.amount);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error(`${label}: laborBonus.amount must be a non-zero integer`);
  }
  // A string names one tag; an array names several, any ONE of which
  // satisfies the tool (the Plow: a Horse or an Arelitz will both pull it).
  const requiresTag =
    entry.requiresTag == null
      ? null
      : Array.isArray(entry.requiresTag)
        ? entry.requiresTag.map(String)
        : String(entry.requiresTag);
  return { kind, amount, equipped: entry.equipped !== false, requiresTag };
}

// Two things the shape alone can't catch: a bonus that only pays while
// equipped on a tag nothing can equip, and a requiresTag naming a tag that
// isn't in the catalog.
function validateLaborBonus(normalized, { selfSlug, tagSlugs, equippable, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  if (normalized.equipped && !equippable) {
    throw new Error(
      `${label}: "${selfSlug}" has a laborBonus that requires being equipped, but the tag is not equippable`,
    );
  }
  const required = normalized.requiresTag == null ? [] : Array.isArray(normalized.requiresTag) ? normalized.requiresTag : [normalized.requiresTag];
  if (required.length === 0 && Array.isArray(normalized.requiresTag)) {
    throw new Error(`${label}: "${selfSlug}" laborBonus.requiresTag is an empty list`);
  }
  for (const slug of required) {
    if (!tagSlugs.has(slug)) {
      throw new Error(`${label}: "${selfSlug}" laborBonus.requiresTag names unknown tag "${slug}"`);
    }
  }
}

// The `placement:` block — what makes a craftable BUILD ON SITE (a Structure
// row at the builder's Location) instead of landing in a pocket, from
// docs/tags.yaml (schema.prisma's Tag.placement comment has the full shape).
// Normalised here, same posture as laborBonus above: db/lib/structures.js is
// the read side and trusts this shape rather than re-deriving it.
//
// Shape checks only — no selfSlug in the messages, matching
// normalizeLaborBonus above. Cross-field rules (craftable, never
// tradeable/stackable/equippable/carryBonus, provides naming real tags) need
// the rest of the tag entry and knownSlugs, so those live in validatePlacement.
function normalizePlacement(raw, label = "docs/tags.yaml") {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: placement must be a mapping`);
  }
  // No hp key, deliberately: structure condition is the status enum and the
  // words printed from it, never a numeric pool (the plan cut HP on purpose).
  if (raw.hp != null) {
    throw new Error(`${label}: placement.hp is not a thing — condition is status words, not a pool`);
  }
  if (raw.unique != null && typeof raw.unique !== "boolean") {
    throw new Error(`${label}: placement.unique must be a boolean`);
  }
  if (raw.fieldwork != null && typeof raw.fieldwork !== "boolean") {
    throw new Error(`${label}: placement.fieldwork must be a boolean`);
  }
  if (raw.examine != null && (typeof raw.examine !== "string" || !raw.examine.trim())) {
    throw new Error(`${label}: placement.examine must be a non-empty string`);
  }
  if (raw.defenseNote != null && (typeof raw.defenseNote !== "string" || !raw.defenseNote.trim())) {
    throw new Error(`${label}: placement.defenseNote must be a non-empty string`);
  }
  if (raw.provides != null && (!Array.isArray(raw.provides) || raw.provides.some((s) => typeof s !== "string"))) {
    throw new Error(`${label}: placement.provides must be a list of tag slugs`);
  }
  if (raw.inscribable != null && typeof raw.inscribable !== "boolean") {
    throw new Error(`${label}: placement.inscribable must be a boolean`);
  }
  // Where this type may be raised at all, by Location slug. ABSENT means
  // anywhere the ground rules allow — the gate is opt-in, so the twelve
  // structures written before it keep working untouched. A slug list rather
  // than a zone list because it is the more precise tool and because
  // `unique` is already per-Location: naming exactly one Location is how a
  // type becomes one-of-a-kind without a game-wide uniqueness rule, which
  // does not exist.
  if (
    raw.locations != null &&
    (!Array.isArray(raw.locations) || raw.locations.some((s) => typeof s !== "string" || !s.trim()))
  ) {
    throw new Error(`${label}: placement.locations must be a list of location slugs`);
  }
  // What this structure PRODUCES every turn, into a Room's floor rather than
  // into anybody's pockets (db/lib/structureYieldPass.js). The room is named
  // by slug and need not be at the structure's own Location — the Brewery
  // stands at the inn and pours into its cellar.
  let yields = null;
  if (raw.yields != null) {
    if (typeof raw.yields !== "object" || Array.isArray(raw.yields)) {
      throw new Error(`${label}: placement.yields must be a mapping`);
    }
    const tag = String(raw.yields.tag ?? "").trim();
    const room = String(raw.yields.room ?? "").trim();
    if (!tag) throw new Error(`${label}: placement.yields.tag must be a tag slug`);
    if (!room) throw new Error(`${label}: placement.yields.room must be a room slug`);
    const quantity = raw.yields.quantity == null ? 1 : Number(raw.yields.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`${label}: placement.yields.quantity must be a positive integer`);
    }
    // Who has to be MINDING it. A skill slug: the structure produces nothing
    // on a turn that closes with nobody standing at its Location who counts
    // as having that skill — "counts as" meaning the tier ladder, so a
    // Brewing (Skilled) brewer satisfies a `brewing-basic` requirement
    // (db/lib/medicalVision.js#satisfiedSkillIds). Absent means the thing
    // runs itself.
    const skill = raw.yields.skill == null ? null : String(raw.yields.skill).trim();
    if (raw.yields.skill != null && !skill) {
      throw new Error(`${label}: placement.yields.skill must be a tag slug`);
    }
    yields = { tag, room, quantity, skill };
  }
  // How many bird flights a day standing here is worth (BIRD.md). The Bird's
  // own allowance is 1; a structure raises it, and the biggest one at the
  // Location wins — the same best-wins posture structureTools keeps for
  // laborBonus, so two rookeries are not twice a rookery.
  let birdSendsPerDay = null;
  if (raw.birdSendsPerDay != null) {
    const n = Number(raw.birdSendsPerDay);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`${label}: placement.birdSendsPerDay must be a positive integer`);
    }
    birdSendsPerDay = n;
  }
  // Music: what the six-hourly sweep pays a listener, and the item that has
  // to be lying about for any of it to happen (bot/src/lib/stagePlay.js).
  let music = null;
  if (raw.music != null) {
    if (typeof raw.music !== "object" || Array.isArray(raw.music)) {
      throw new Error(`${label}: placement.music must be a mapping`);
    }
    const mood = Number(raw.music.mood);
    // Positive only, and for the reason laborBonus.amount gives: relief is
    // never multiplied (MOOD.md §7), so a negative here would be a harm term
    // wearing a relief's clothes and would skip every phobia it should read.
    if (!Number.isInteger(mood) || mood < 1) {
      throw new Error(`${label}: placement.music.mood must be a positive integer`);
    }
    const needs = String(raw.music.needs ?? "").trim();
    if (!needs) throw new Error(`${label}: placement.music.needs must be a tag slug`);
    music = { mood, needs };
  }
  let laborBonus = null;
  if (raw.laborBonus != null) {
    if (typeof raw.laborBonus !== "object" || Array.isArray(raw.laborBonus)) {
      throw new Error(`${label}: placement.laborBonus must be a mapping`);
    }
    const kind = String(raw.laborBonus.kind ?? "").toLowerCase();
    if (!LABOR_BONUS_KINDS.has(kind)) {
      throw new Error(`${label}: placement.laborBonus.kind must be one of ${[...LABOR_BONUS_KINDS].join(", ")}`);
    }
    const amount = Number(raw.laborBonus.amount);
    // Positive only: a malus would apply to EVERYONE laboring the ground,
    // and a negative bonus can drag the paid range's floor below zero,
    // where the machine expression stops parsing and pays nothing at all.
    if (!Number.isInteger(amount) || amount < 1) {
      throw new Error(`${label}: placement.laborBonus.amount must be a positive integer`);
    }
    laborBonus = { kind, amount };
  }
  return {
    unique: raw.unique !== false,
    fieldwork: raw.fieldwork === true,
    examine: raw.examine ?? null,
    defenseNote: raw.defenseNote ?? null,
    laborBonus,
    locations: raw.locations ?? [],
    yields,
    birdSendsPerDay,
    music,
    provides: raw.provides ?? [],
    // The builder may write a line on the finished thing
    // (Structure.inscription) — their words replace `examine` in the
    // readout. The wayside shrine's flag; see CRAFTING.md.
    inscribable: raw.inscribable === true,
  };
}

// `customizable:` — the recipe may be crafted as a player-named custom item
// (CRAFTING.md; the craft mints a custom+ephemeral row via the paperMint.js
// door), and `customizableSkill:` is the tag somebody has to hold to do it —
// `smithing-skilled` on the arms and armour. A typo there would open the door
// to nobody at all rather than fail loudly, which is why the slug is checked
// against the catalog the way excludedRoles is. Four rules, each closing a
// real hole rather than expressing taste:
// not craftable and nothing would ever mint one; not stackable and the
// one-per-character checks (craftGrantChecks, tier replacement) compare the
// BASE tag's id against held ids, which a minted row never matches — so a
// non-stackable custom would dodge its own exclusivity; and a `placement:`
// recipe is a Structure with its own words (placement.inscribable), not a
// pocket item to rename.
function validateCustomizable(entry, { slug, knownSlugs = null, label = "docs/tags.yaml" }) {
  // The skill gate is authored on the recipe, so it is checked even when the
  // recipe is not customizable at all — a `customizableSkill` left behind on a
  // row whose flag came off would otherwise sit there gating nothing.
  const gate = entry?.customizableSkill;
  if (gate !== undefined && gate !== null) {
    if (typeof gate !== "string" || !gate.trim()) {
      throw new Error(`${label}: tag "${slug}" customizableSkill must be a tag slug`);
    }
    if (knownSlugs && !knownSlugs.has(gate)) {
      throw new Error(`${label}: tag "${slug}" customizableSkill references unknown tag "${gate}"`);
    }
    if (!entry.customizable) {
      throw new Error(`${label}: tag "${slug}" has customizableSkill but is not customizable — the gate would guard a door that isn't there`);
    }
  }
  if (!entry?.customizable) return;
  if (!entry.craftable) {
    throw new Error(`${label}: tag "${slug}" is customizable but not craftable — nothing would ever mint one`);
  }
  if (!entry.stackable) {
    throw new Error(`${label}: tag "${slug}" is customizable but not stackable — a minted custom row dodges the base recipe's one-per-character checks`);
  }
  if (entry.placement) {
    throw new Error(`${label}: tag "${slug}" is customizable and carries placement — a structure takes placement.inscribable, not a custom name`);
  }
}

// --- Cooking (docs/systemdocs/COOKING.md) ---------------------------------

// Longer than a taste needs and shorter than a sentence. The string is
// dropped into the middle of one line a player reads once, so anything past
// this is prose that belongs in the tag's own description instead.
const COOKED_TASTE_MAX = 40;

// What a tag contributes AS AN INGREDIENT, from its `cooked:` block. The
// presence of the block is the only thing that makes a tag cookable — there
// is no `ingredient: true` flag and no per-recipe list of legal slugs, so
// adding a fourteenth thing you can cook with is one entry and a sync.
//
//     cooked:
//       taste: "little crunchies"
//       mood: 28
//       into: [nauseous]        # optional — see below
//
// IF YOU ARE HERE FROM THE MEDICAL REWORK: `into` needs no hook and never
// did — omitting it means "contribute my own `consumesInto`", looked up when
// somebody eats the dish rather than frozen in when it was cooked, so
// changing what a medicine does changes what it does in a stew, for every
// dish already in every pocket, with no code here.
//
// `cures` is the half that DOES need a hook, because the medical pass put
// cures on their own `Tag.cures` column rather than on `consumesInto`, and
// nothing about a separate column travels for free. It is opt-in per
// ingredient and defaults to OFF, because not every cure is swallowed:
//
//     cooked:
//       taste: "medicine"
//       mood: 15
//       cures: true             # this one is drunk, so it works in a stew
//
// Write `cures: true` on a tonic somebody drinks — White Honey, Antidote,
// Fever Draught, Purifier, Antibiotics, Forgiveness. Leave it off anything
// injected, applied or strapped on: a Burn Dressing, Leeches, Cleaning
// Powder, an autoinjector, a prosthetic. Those cure a person, not a stew,
// and cooking one into dinner should do nothing but ruin the dinner.
// COOKING.md §4-5 has the reasoning and the raw-vs-cooked table.
//
// `into` is parsed by the caller's own consumesInto normalizer (passed in as
// `normalizeInto`), so every shape that works there works here for free
// rather than through a second parser that drifts from the first.
function normalizeCooked(cooked, { slug, normalizeInto, label = "docs/tags.yaml" }) {
  if (cooked == null) return null;
  if (typeof cooked !== "object" || Array.isArray(cooked)) {
    throw new Error(`${label}: tag "${slug}" cooked must be a block with a taste and a mood`);
  }
  const taste = cooked.taste;
  // The key is required; its VALUE may be empty. An empty taste is the
  // undetectable poison — Phrygian Tears, Adder's Bite — and a dish carrying
  // one reads exactly like a dish that is not, because web/lib/cooking.js
  // drops an empty fragment from the line rather than printing a gap.
  // Requiring the key is what keeps that a deliberate claim rather than a
  // forgotten field: `taste: ""` says tasteless, an absent `taste:` is a slip.
  if (typeof taste !== "string") {
    throw new Error(
      `${label}: tag "${slug}" cooked needs a taste — write taste: "" if it is deliberately undetectable`,
    );
  }
  if (taste.trim().length > COOKED_TASTE_MAX) {
    throw new Error(
      `${label}: tag "${slug}" cooked.taste is ${taste.trim().length} characters — keep it under ${COOKED_TASTE_MAX}, it sits mid-sentence`,
    );
  }
  const mood = cooked.mood ?? 0;
  if (!Number.isFinite(mood)) {
    throw new Error(`${label}: tag "${slug}" cooked.mood must be a number`);
  }
  // The dial itself. A single ingredient past either end is always an
  // authoring slip, and clamping it silently would hide one. Required lazily:
  // mood.js does not require this file, so there is no cycle, but keeping the
  // require inside the function makes that hard to break by accident.
  const { MOOD_MAX, MOOD_MIN } = require("./mood");
  if (mood > MOOD_MAX || mood < MOOD_MIN) {
    throw new Error(
      `${label}: tag "${slug}" cooked.mood is ${mood} — the dial runs +${MOOD_MAX} to ${MOOD_MIN}`,
    );
  }
  const into = cooked.into == null ? null : normalizeInto(cooked.into);
  // Opt-in, and stored only when true — an absent key and `cures: false` are
  // the same claim, so writing the false out would put a column of noise in
  // every one of the fifty-odd blocks that will never carry a cure.
  if (cooked.cures != null && typeof cooked.cures !== "boolean") {
    throw new Error(
      `${label}: tag "${slug}" cooked.cures must be true or false — it says whether this ingredient's OWN cures list survives the pot, not which cures`,
    );
  }
  const cures = cooked.cures === true;
  return { taste: taste.trim(), mood, into, ...(cures ? { cures: true } : {}) };
}

// `inlayValue` — TRINKETS.md: what a raw material adds to a minted Trinket's
// sell price when a smith inlays it. Modeled on `cooked` above as an
// optional numeric annotation on a raw-material tag, but far more permissive
// — see the schema comment on Tag.inlayValue for why. Just a positive whole
// number, or absent.
function normalizeInlayValue(value, { slug, label = "docs/tags.yaml" } = {}) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${label}: tag "${slug}" inlayValue must be a positive whole number`,
    );
  }
  return value;
}

// `cooked` deliberately does NOT require `consumable`. Being cookable and
// being edible are different claims, and the six body parts are the case that
// proves it: nobody gnaws a raw hand, and a hand in a stew is very much a
// thing that can happen. The cooking path reads this block; the consume path
// never sees it.
//
// The inverse is worth writing out too, because it looks like an omission and
// is not: an ingredient that does nothing RAW says so with `consumable: true`
// and an empty `consumesInto`. That is the honest way to write an onion —
// you can put one in your mouth and the game lets you, and then nothing
// happens — and it keeps "nothing happened" a real answer rather than a
// missing one.
function validateCooked(normalized, { selfSlug, tagSlugs, entry: tagEntry, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  // `cures: true` says "what I cure, I cure through the pot". Two shapes make
  // that a nonsense claim and both are authoring slips rather than choices:
  // a tag with nothing to cure, and a tag whose cure has to be FITTED. The
  // second is the one worth a hard refusal — `administerSkill` is exactly the
  // set of cures a doctor puts on or into somebody (the prosthetics, the
  // autoinjectors), and none of those is a thing you eat.
  if (normalized.cures) {
    if (tagEntry && tagEntry.administerSkill) {
      throw new Error(
        `${label}: tag "${selfSlug}" is cooked.cures true and carries administerSkill — a cure a doctor has to fit or inject does not travel in a stew`,
      );
    }
    if (tagEntry && !(tagEntry.cures ?? []).length) {
      throw new Error(
        `${label}: tag "${selfSlug}" is cooked.cures true but cures nothing — drop the line`,
      );
    }
  }
  for (const entry of normalized.into ?? []) {
    for (const target of entry.oneOf ?? [entry.slug]) {
      if (!tagSlugs?.has(target)) {
        throw new Error(`${label}: tag "${selfSlug}" cooked.into references unknown tag "${target}"`);
      }
    }
  }
}

// How many ingredients a recipe takes, from `requirement.ingredientSlots`.
// A sibling of requirement.items rather than a second `anyOf`: the legal set
// is "any tag carrying a cooked block", which no authored list could keep up
// with, and validateRequirementItems' one-picker cap stays exactly where it
// is, still guarding the Death Mask and the Dreamer's Draught.
const INGREDIENT_SLOTS_MAX = 4;

function normalizeIngredientSlots(slots, { slug, label = "docs/tags.yaml" }) {
  if (slots == null) return null;
  if (typeof slots !== "object" || Array.isArray(slots)) {
    throw new Error(`${label}: tag "${slug}" requirement.ingredientSlots must be a { min, max } block`);
  }
  const min = slots.min ?? 0;
  const max = slots.max ?? min;
  for (const [key, value] of [["min", min], ["max", max]]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label}: tag "${slug}" requirement.ingredientSlots.${key} must be a whole number`);
    }
  }
  if (max < min) {
    throw new Error(`${label}: tag "${slug}" requirement.ingredientSlots.max (${max}) is below its min (${min})`);
  }
  if (max < 1) {
    throw new Error(`${label}: tag "${slug}" requirement.ingredientSlots.max is 0 — a recipe that takes no ingredient should not declare slots`);
  }
  if (max > INGREDIENT_SLOTS_MAX) {
    throw new Error(`${label}: tag "${slug}" requirement.ingredientSlots.max is ${max} — the dialog draws at most ${INGREDIENT_SLOTS_MAX}`);
  }
  return { min, max };
}

function validateIngredientSlots(normalized, { selfSlug, craftable, placement = null, turnsCost = null, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  // Same reasoning as requirement.items: the Craft path is the only place
  // slots are ever read, so declaring them anywhere else is a lie.
  if (!craftable) {
    throw new Error(`${label}: tag "${selfSlug}" declares ingredientSlots but is not craftable — nothing would ever check them`);
  }
  if (placement) {
    throw new Error(`${label}: tag "${selfSlug}" declares ingredientSlots and placement — a build site never spends an ingredient`);
  }
  // A multi-turn project mints on the FINISHING turn, days after the cook
  // picked their ingredients, so the slugs would have to ride on
  // CraftProject.custom to survive the wait. Nothing needs that today, and a
  // recipe that quietly forgot what went into it is a worse bug than a sync
  // that refuses to ship one.
  if (Number.isInteger(turnsCost) && turnsCost >= 2) {
    throw new Error(
      `${label}: tag "${selfSlug}" declares ingredientSlots on a ${turnsCost}-turn project — the picked slugs would not survive to the finishing turn`,
    );
  }
}

// What a customizable recipe charges for the player's words, and whether it
// takes a description at all. Only legal beside `customizable: true`.
//
//     custom: { cost: 0, describable: false }
//
// An absent `cost` means the standard surcharge (web/lib/customCraft.js). `0`
// is the meals: a cook naming their own dish is the point of the cooking
// rework, not an upsell.
function normalizeCustom(custom, { slug, customizable, label = "docs/tags.yaml" }) {
  if (custom == null) return { customCost: null, customDescribable: true };
  if (!customizable) {
    throw new Error(`${label}: tag "${slug}" declares a custom block but is not customizable`);
  }
  if (typeof custom !== "object" || Array.isArray(custom)) {
    throw new Error(`${label}: tag "${slug}" custom must be a block`);
  }
  const cost = custom.cost ?? null;
  if (cost != null && (!Number.isInteger(cost) || cost < 0)) {
    throw new Error(`${label}: tag "${slug}" custom.cost must be 0 or a positive whole number of ⬢`);
  }
  return { customCost: cost, customDescribable: custom.describable !== false };
}

// Two things the shape alone can't catch: a placement block on a tag nothing
// would ever build (the Craft path is the only enforcement point, same
// reasoning as validateRequirementItems), and a placement block on a tag that
// could otherwise leave a Location — tradeable, stackable, equippable and
// carryBonus all mean "this can end up on somebody's person", which a
// Structure never does. `tag` is the raw YAML entry, so those flags are read
// as authored rather than re-derived.
function validatePlacement(placement, { slug, tag, knownSlugs, label = "docs/tags.yaml" }) {
  if (!placement) return;
  if (!tag?.craftable) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but is not craftable — the build path is the only enforcement point`,
    );
  }
  if (tag.tradeable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is tradeable — a structure is never on anyone's person`);
  }
  if (tag.stackable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is stackable — a structure is never on anyone's person`);
  }
  if (tag.equippable) {
    throw new Error(`${label}: tag "${slug}" declares placement but is equippable — a structure is never on anyone's person`);
  }
  if (tag.carryBonus != null) {
    throw new Error(`${label}: tag "${slug}" declares placement but carries a carryBonus — a structure is never on anyone's person`);
  }
  if (tag.laborBonus != null) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but a top-level laborBonus — a structure is never held, so that would be dead config; use placement.laborBonus`,
    );
  }
  for (const provided of placement.provides) {
    if (!knownSlugs.has(provided)) {
      throw new Error(`${label}: tag "${slug}" placement.provides references unknown tag "${provided}"`);
    }
  }
  if (placement.yields && !knownSlugs.has(placement.yields.tag)) {
    throw new Error(`${label}: tag "${slug}" placement.yields.tag references unknown tag "${placement.yields.tag}"`);
  }
  if (placement.yields?.skill && !knownSlugs.has(placement.yields.skill)) {
    throw new Error(`${label}: tag "${slug}" placement.yields.skill references unknown tag "${placement.yields.skill}"`);
  }
  if (placement.music && !knownSlugs.has(placement.music.needs)) {
    throw new Error(`${label}: tag "${slug}" placement.music.needs references unknown tag "${placement.music.needs}"`);
  }
  // `placement.locations` and `placement.yields.room` name LOCATIONS and
  // ROOMS, which live in docs/zones.yaml behind a different sync — knownSlugs
  // holds tag slugs and nothing else, so there is nothing here to check them
  // against. Same reasoning syncZones.js keeps for the tag slugs it cannot
  // see (SYNC.md): the two masters sync independently, so a cross-master
  // reference is resolved at RUNTIME and must fail soft. It does — the yield
  // pass logs and skips a room it cannot find, and the build gate refuses a
  // Location that does not match rather than throwing.
  // A 0-turn placement would be born finished with turnsDone above
  // turnsNeeded — a build takes at least one crew-turn, always.
  const turns = tag.requirement?.turnsCost ?? 1;
  if (!Number.isInteger(turns) || turns < 1) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but requirement.turnsCost is ${tag.requirement?.turnsCost} — a structure takes at least 1 crew-turn`,
    );
  }
}

// ─── fighting ───────────────────────────────────────────────────────────────
// The `fighting:` block — what a tag does in a fight (docs/systemdocs/COMBAT.md).
// Normalised here, same posture as laborBonus and placement above:
// db/lib/fightingSkill.js is the read side and trusts this shape rather than
// re-deriving it.
//
// The one thing worth knowing before reading the code: the YAML authors TIERS
// and this stores POINTS. Tiers are what twenty tag descriptions already say
// ("counts as 2 tiers higher"), so authoring in anything else would make the
// catalog and its own prose disagree. Points are what the arithmetic wants,
// because a tier takes decimals and a running total should not.
const { BANDS, POINTS_PER_TIER, WEAPON_CLASSES } = require("./fightingSkill");

const FIGHTING_TREES = new Set(["melee", "ranged", "both"]);
const FIGHTING_BAND_KEYS = new Set(BANDS.map((b) => b.key));
// `holds` is AND — every slug must be held. `holdsAny` is OR, for a condition
// that spans rungs of one ladder: the drinking rungs replace each other, so a
// tag keyed to "being drunk at all" can never name them with `holds`.
const FIGHTING_WHEN_KEYS = new Set(["weaponClass", "holds", "holdsAny", "equipped", "unarmoured"]);

// A tier is authored to one decimal place and nothing finer. The check is not
// fussiness: `tiers: 0.25` would silently become 2.5 points, round somewhere,
// and land as a value nobody authored. Refusing it means a typo fails the sync
// instead of quietly changing a tag.
function tiersToPoints(value, label, what) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label}: ${what} must be a number`);
  const points = n * POINTS_PER_TIER;
  if (!Number.isInteger(Math.round(points * 1000) / 1000)) {
    throw new Error(`${label}: ${what} must be a multiple of 0.1 tiers, got ${n}`);
  }
  return Math.round(points);
}

function normalizeStringList(raw, field, label) {
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) return null;
  return list.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${label}: ${field} entries must be non-empty strings`);
    }
    return entry.trim();
  });
}

function normalizeFightingWhen(raw, label) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: fighting.when must be a mapping`);
  }
  for (const key of Object.keys(raw)) {
    if (!FIGHTING_WHEN_KEYS.has(key)) {
      throw new Error(`${label}: fighting.when has unknown key "${key}" — expected ${[...FIGHTING_WHEN_KEYS].join(", ")}`);
    }
  }
  const when = {};
  for (const key of FIGHTING_WHEN_KEYS) {
    const list = normalizeStringList(raw[key], `fighting.when.${key}`, label);
    if (list) when[key] = list;
  }
  if (!Object.keys(when).length) {
    throw new Error(`${label}: fighting.when is empty — drop it rather than writing a condition that is always true`);
  }
  for (const cls of when.weaponClass ?? []) {
    if (!WEAPON_CLASSES.has(cls)) {
      throw new Error(`${label}: fighting.when.weaponClass has unknown class "${cls}"`);
    }
  }
  return when;
}

function normalizeFighting(raw, label = "docs/tags.yaml") {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: fighting must be a mapping`);
  }

  const out = {};

  if (raw.tree != null) {
    const tree = String(raw.tree).toLowerCase();
    if (!FIGHTING_TREES.has(tree)) {
      throw new Error(`${label}: fighting.tree must be one of ${[...FIGHTING_TREES].join(", ")}`);
    }
    out.tree = tree;
  }

  // Rungs are 1-indexed: Basic is the first rung of the ladder, not the
  // zeroth. Rung 0 would mean "on the ladder at the height of somebody who
  // isn't", which is a block that says nothing — and saying nothing is spelt
  // by leaving the block off.
  if (raw.rung != null) {
    if (!Number.isInteger(raw.rung) || raw.rung < 1) {
      throw new Error(`${label}: fighting.rung must be an integer of at least 1 — Basic is rung 1`);
    }
    out.rung = raw.rung;
  }

  // `tiers` and `points` are the same field in two units. Authoring both would
  // be two answers to one question, so it is refused rather than picked between.
  if (raw.tiers != null && raw.points != null) {
    throw new Error(`${label}: fighting names both tiers and points — write one`);
  }
  if (raw.tiers != null) out.points = tiersToPoints(raw.tiers, label, "fighting.tiers");
  if (raw.points != null) {
    if (!Number.isInteger(raw.points)) throw new Error(`${label}: fighting.points must be an integer`);
    out.points = raw.points;
  }

  for (const key of ["floor", "cap"]) {
    if (raw[key] == null) continue;
    const band = String(raw[key]).toLowerCase();
    if (!FIGHTING_BAND_KEYS.has(band)) {
      throw new Error(`${label}: fighting.${key} must be a band key — ${[...FIGHTING_BAND_KEYS].join(", ")}`);
    }
    out[key] = band;
  }

  if (raw.weaponClass != null) {
    const cls = String(raw.weaponClass).toLowerCase();
    if (!WEAPON_CLASSES.has(cls)) {
      throw new Error(`${label}: fighting.weaponClass must be one of ${[...WEAPON_CLASSES].join(", ")}`);
    }
    out.weaponClass = cls;
  }

  const when = normalizeFightingWhen(raw.when, label);
  if (when) out.when = when;

  // A FLAG, not a sentence. It used to carry the condition as prose ("when
  // dueling", "at long range") and that came back out of the catalog: which
  // moment a tag is for is already in the tag's own description, and saying it
  // twice is two things to keep in step. All this says now is: a gamemaster
  // decides this one, so it never enters the number.
  if (raw.situational != null) {
    if (raw.situational !== true) {
      throw new Error(`${label}: fighting.situational is a flag — write \`true\` or leave it out`);
    }
    out.situational = true;
  }

  const cancels = normalizeStringList(raw.cancels, "fighting.cancels", label);
  if (cancels) out.cancels = cancels;

  if (!Object.keys(out).length) {
    throw new Error(`${label}: fighting is empty — drop the block rather than writing one that says nothing`);
  }
  return out;
}

// What the shape alone cannot catch: a block that says nothing the resolver
// will ever read, a condition naming a tag that is not in the catalog, and a
// weapon that cannot be equipped. Each of these is a SILENT no-op at runtime
// rather than a crash, which is exactly why they are caught at the door.
function validateFighting(normalized, { selfSlug, tagSlugs, equippable, label = "docs/tags.yaml" }) {
  if (!normalized) return;

  const saysSomething =
    normalized.rung != null ||
    normalized.points != null ||
    normalized.floor ||
    normalized.cap ||
    normalized.weaponClass ||
    // `situational: true` on its own is a real answer: Camouflage has no tier
    // and no tree, and still has to reach the sheet's situational list. That
    // list is the whole reason such a tag carries a block at all.
    normalized.situational ||
    normalized.cancels;
  if (!saysSomething) {
    throw new Error(`${label}: "${selfSlug}" fighting has a condition but nothing to apply — add tiers, a floor, or a note`);
  }

  // A shift needs to know which half of the tree it lands on. A weapon is the
  // exception: its class already answers that, and saying it twice invites the
  // two to disagree.
  if (normalized.points != null && !normalized.tree && !normalized.weaponClass) {
    throw new Error(`${label}: "${selfSlug}" fighting has tiers but no tree — write melee, ranged, or both`);
  }
  if (normalized.weaponClass && normalized.tree) {
    throw new Error(`${label}: "${selfSlug}" fighting names a weaponClass and a tree — the class already decides the tree`);
  }
  if (normalized.weaponClass && !equippable) {
    throw new Error(`${label}: "${selfSlug}" fighting names a weaponClass, but the tag is not equippable — a weapon nobody can draw is worth nothing`);
  }

  // Every condition and cancellation names a real tag. A typo here would read
  // as a bonus that simply never fires.
  for (const field of ["holds", "holdsAny", "equipped"]) {
    for (const slug of normalized.when?.[field] ?? []) {
      if (!tagSlugs.has(slug)) {
        throw new Error(`${label}: "${selfSlug}" fighting.when.${field} names unknown tag "${slug}"`);
      }
    }
  }
  for (const slug of normalized.cancels ?? []) {
    if (!tagSlugs.has(slug)) {
      throw new Error(`${label}: "${selfSlug}" fighting.cancels names unknown tag "${slug}"`);
    }
    if (slug === selfSlug) {
      throw new Error(`${label}: "${selfSlug}" fighting.cancels itself — a tag cannot undo its own contribution`);
    }
  }
}

module.exports = {
  DEAD_TOKEN,
  LABOR_BONUS_KINDS,
  normalizeFighting,
  validateFighting,
  normalizeLaborBonus,
  validateLaborBonus,
  normalizeExpiresInto,
  validateExpiresInto,
  normalizeRemovesInto,
  validateRemovesInto,
  validateEscalatesInto,
  validateEscalationChains,
  normalizeCures,
  validateCures,
  normalizeCuresInto,
  validateCuresInto,
  validateAdministerSkill,
  normalizeResists,
  validateResists,
  rollTagChain,
  normalizeTurnsCost,
  validateHealableRequirement,
  normalizeRequirementItems,
  validateRequirementItems,
  normalizePlacement,
  validatePlacement,
  validateCustomizable,
  COOKED_TASTE_MAX,
  INGREDIENT_SLOTS_MAX,
  normalizeCooked,
  normalizeInlayValue,
  validateCooked,
  normalizeIngredientSlots,
  validateIngredientSlots,
  normalizeCustom,
};
