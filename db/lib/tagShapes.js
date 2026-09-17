// Shared shape helpers for the tag columns that hold JSON, used by both docs/tags.yaml (db/lib/syncTags.js) and the GM tag form (web/app/(app)/gm/dev/tags/actions.js) so both doors enforce one rule set.
// Messages take a `label` so each caller can name its own source.

// A chain entry (expiresInto/removesInto) is a bare slug or an even random pick ({ oneOf: [...] }); both normalise to { oneOf: [...] } so every reader handles one shape. Null stays null.
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

// `dead` is a reserved expiry-chain token, not a catalog tag (death is Character.status, not held): db/lib/tagExpiryPass.js stamps the Dying grant for THIS turn instead of next, so db/lib/dyingDeathPass.js does the kill.
// Carried by arterial-bleed, phrygian-toxin and crucified.
const DEAD_TOKEN = "dead";

// Every chain slug must exist and not be the tag's own slug; `allowDead` opens the reserved token to expiresInto only — removesInto leaves it closed since curing a wound must never kill.
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

// The three rules an expiry chain must satisfy, each a silent no-op rather than an error if unchecked, so they are checked up front on both doors.
function validateExpiresInto(normalized, { selfSlug, knownSlugs, durationTurns, label = "docs/tags.yaml" }) {
  // Self-expiry would be re-granted then immediately deleted by the sweep (matches on tag id) — write a two-tag loop instead (migraine <-> no-migraine).
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
  // `dead` may not ride alongside another entry: entries are all granted at once, and nobody is left to hold the other one.
  if ((normalized?.length ?? 0) > 1 && normalized.some(({ oneOf }) => oneOf.includes(DEAD_TOKEN))) {
    throw new Error(
      `${label}: tag "${selfSlug}" expiresInto lists "${DEAD_TOKEN}" beside another entry — the holder is dead, so nothing else could land`,
    );
  }
}

// escalatesInto — the rung ABOVE this tag on a ladder (docs/tags.yaml's header, docs/systemdocs/BREWING.md); consuming a tag you already hold clears it and grants this instead.
// One bare slug, not { oneOf }: a ladder has exactly one next rung.
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

// cures — the medical pass's item-cure list (TAGS.md §5c). A flat list of health-tag slugs, not the { oneOf } chain shape: an item cures everything in its list the target holds, not a random pick.
function normalizeCures(entries, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries) || entries.some((s) => typeof s !== "string" || !s)) {
    throw new Error(`${label}: cures must be a list of tag slugs`);
  }
  if (entries.length === 0) return null;
  return [...new Set(entries)];
}

// Every cured slug must exist and be category Health, and the carrier must be consumable. Deliberately NOT checked against `healable`: Forgiveness cures the untreatable Shell Shocked on purpose.
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

// removesOnConsume — a flat slug list stripped off the CONSUMER on consume, lighter than cures: no Health restriction, no removesInto, no medical-pass tie. For items undoing an unrelated tag (Coffee clearing Tired, Bar Soap clearing Unhygienic).
function normalizeRemovesOnConsume(entries, label = "docs/tags.yaml") {
  if (entries == null) return null;
  if (!Array.isArray(entries) || entries.some((s) => typeof s !== "string" || !s)) {
    throw new Error(`${label}: removesOnConsume must be a list of tag slugs`);
  }
  if (entries.length === 0) return null;
  return [...new Set(entries)];
}

// Same door as cures, minus the category check.
function validateRemovesOnConsume(normalized, { selfSlug, knownSlugs, consumable, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  if (!consumable) {
    throw new Error(`${label}: tag "${selfSlug}" declares removesOnConsume but is not consumable — nothing would ever apply it`);
  }
  for (const slug of normalized) {
    if (!knownSlugs.has(slug)) {
      throw new Error(`${label}: tag "${selfSlug}" removesOnConsume references unknown tag "${slug}"`);
    }
  }
}

// curesInto — per-item aftermath override sidecar (prosthetics: a crafted peg-leg cures missing-leg into peg-leg). A mapping: { <cured-slug>: <aftermath-slug> }.
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

// Keys must be a subset of this tag's own `cures` (an override for a slug it doesn't cure would never fire); values are any catalog slug, same as removesInto.
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

// administerSkill — a single catalog slug, existence-checked only; names a skill tag but need not be one of requirementSkills' rows.
function validateAdministerSkill(value, { knownSlugs, selfSlug, label = "docs/tags.yaml" }) {
  if (value == null) return;
  if (typeof value !== "string" || !value) {
    throw new Error(`${label}: tag "${selfSlug}" administerSkill must be a single tag slug`);
  }
  if (!knownSlugs.has(value)) {
    throw new Error(`${label}: tag "${selfSlug}" administerSkill references unknown tag "${value}"`);
  }
}

// resists — Iron Constitution's sidecar. A flat list of slugs, same shape as cures; existence is the only rule.
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

// The whole-document half of the check: a per-tag rule can't catch tipsy -> wasted -> tipsy, and the resolver walks this chain in a loop, so a cycle would hang the request. `bySlug` maps slug -> escalatesInto (or null).
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

// removesInto — what a tag turns into on a player-driven removal (Remove Tag, or Heal). Same shape as expiresInto; no duration requirement since removal itself fires it.
function normalizeRemovesInto(entries, label = "docs/tags.yaml") {
  return normalizeTagChain("removesInto", entries, label);
}

function validateRemovesInto(normalized, { selfSlug, knownSlugs, label = "docs/tags.yaml" }) {
  // Self-check: re-granting the tag just paid to remove would make removal a no-op with a bill attached.
  validateChainSlugs("removesInto", normalized, {
    selfSlug,
    knownSlugs,
    label,
    selfProblem: "removing it would grant it right back.",
  });
}

// Rolls a stored (normalized) chain into concrete slugs — same roll db/lib/tagExpiryPass.js makes inline; exposed here for the removal paths.
function rollTagChain(normalized) {
  const slugs = [];
  for (const entry of Array.isArray(normalized) ? normalized : []) {
    const choices = entry?.oneOf ?? [];
    if (!choices.length) continue;
    slugs.push(choices[Math.floor(Math.random() * choices.length)]);
  }
  return slugs;
}

// requirement.items — the INGREDIENT half of a recipe. Four entry shapes: a slug (SPENT), { group: ... } (any tag in a group, KEPT — needed for Miasma, since a corpse tag is written at death and never in docs/tags.yaml), { anyOf: [...] } (player picks one, SPENT), { customOf: ... } (any mint of that recipe, SPENT — reaches a cloned custom Tag by its customOfSlug, which group/anyOf cannot).
// `keep: false` on a group is refused (no single stack to decrement). `label` on each entry is DENORMALIZED on purpose: formatTagRequirement() is pure/sync and called from four surfaces, so resolving names at render time would cost a query each; the sync rewrites the label every run. `anyOf` carries `options: [{ slug, name }]` for the Craft dialog's picker.
function joinWithOr(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// requirement.turnsCost carries the WORK one unit takes: an integer number of Moves, or a `1/N` fraction (`turnsCost: 1/3` means three fill a Routine); quantity is limited by work, never a separate cap. Stores internally as requirementTurns: 1 + requirementPerTurn: N, the engine's existing share encoding.
// `perTurn:` is ONLY legal on a 0-turn recipe, where it is a RATION (a hard daily cap below the Dead Simple pool's 4); on a recipe that costs a Move it is refused.
function normalizeTurnsCost(requirement, { slug, healable = false }, label = "docs/tags.yaml") {
  const raw = requirement?.turnsCost;
  // A healable tag's turnsCost must be authored explicitly: countsAgainstHealCap (web/lib/healRequests.js) reads a MISSING turnsCost as 0, craftMoveCost (web/lib/craftBudget.js) reads it as 1 — an unauthored healable tag would silently split what the Heal dialog shows from what the server bills. validateHealableRequirement below is the same rule for the GM form's door.
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

// The GM tag form's counterpart to normalizeTurnsCost's healable check above: same rule, read off the form's own already-parsed `requirementTurns` since it has no fraction picker (db/lib/syncTags.js's `normalizeTurnsCost` is the only door onto a fractional cure).
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
    // How many units of THIS ingredient one craft takes on top of craft quantity (a blank book is ten sheets). Carried only when not 1 — every reader writes `count ?? 1`. Refused on a `group:` or alongside `keep: true`: both are hold-checks with no stack to decrement.
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
    // A group is HELD, never spent: no one stack to take it out of.
    if (entry.keep === false) {
      throw new Error(
        `${label}: a requirement.items \`group:\` entry cannot set \`keep: false\` — a group names no single stack to spend`,
      );
    }
    // "Corpses" -> "a corpse"; graceless for some names, which is what `as:` is for.
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
  // ONE picker per recipe: the Craft dialog posts a single `ingredientChoice`, so a second anyOf would have no way to be answered.
  if (pickers > 1) {
    throw new Error(`${label}: tag "${selfSlug}" has ${pickers} anyOf ingredients — the Craft dialog posts one choice`);
  }
  // The Craft path is the only enforcement point, so an `items` block on anything else would sit in the catalog looking enforced and do nothing.
  if (!craftable) {
    throw new Error(`${label}: tag "${selfSlug}" declares requirement.items but is not craftable — nothing would ever check it`);
  }
  // A `placement:` recipe is raised by a CREW over several turns (openBuildSiteImpl / joinBuildSite), and nothing on that path spends an ingredient.
  if (placement) {
    throw new Error(
      `${label}: tag "${selfSlug}" declares requirement.items and placement — a build site never spends an ingredient`,
    );
  }
}


// The `laborBonus:` block — what a tool adds to one kind of Laboring (docs/systemdocs/LABORING.md). Normalised here since a typo in `kind` would silently make a tool worthless.
// { kind, amount, equipped, requiresTag } or null. `equipped` defaults TRUE.
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
  // A string names one tag; an array names several, any ONE of which satisfies the tool (the Plow: a Horse or an Arelitz).
  const requiresTag =
    entry.requiresTag == null
      ? null
      : Array.isArray(entry.requiresTag)
        ? entry.requiresTag.map(String)
        : String(entry.requiresTag);
  return { kind, amount, equipped: entry.equipped !== false, requiresTag };
}

// Catches a bonus that only pays while equipped on an unequippable tag, and a requiresTag naming an unknown tag.
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

// The `placement:` block — what makes a craftable BUILD ON SITE (a Structure at the builder's Location) instead of landing in a pocket (schema.prisma's Tag.placement comment has the full shape); db/lib/structures.js is the read side and trusts this shape.
// Shape checks only, no selfSlug. Cross-field rules need the rest of the tag entry and live in validatePlacement.
function normalizePlacement(raw, label = "docs/tags.yaml") {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: placement must be a mapping`);
  }
  // No hp key, deliberately: structure condition is the status enum, never a numeric pool.
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
  // Where this type may be raised, by Location slug. ABSENT means anywhere the ground rules allow (opt-in gate). A slug list, not a zone list: `unique` is already per-Location, so naming one Location makes a type one-of-a-kind with no game-wide uniqueness rule.
  if (
    raw.locations != null &&
    (!Array.isArray(raw.locations) || raw.locations.some((s) => typeof s !== "string" || !s.trim()))
  ) {
    throw new Error(`${label}: placement.locations must be a list of location slugs`);
  }
  // What this structure PRODUCES every turn, into a Room's floor rather than a pocket (db/lib/structureYieldPass.js). The room need not be at the structure's own Location — the Brewery pours into the inn's cellar.
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
    // Who has to be MINDING it: a skill slug, checked against the tier ladder (db/lib/medicalVision.js#satisfiedSkillIds), so a Brewing (Skilled) brewer satisfies `brewing-basic`. Absent means it runs itself.
    const skill = raw.yields.skill == null ? null : String(raw.yields.skill).trim();
    if (raw.yields.skill != null && !skill) {
      throw new Error(`${label}: placement.yields.skill must be a tag slug`);
    }
    yields = { tag, room, quantity, skill };
  }
  // How many bird flights a day standing here is worth (BIRD.md). The Bird's own allowance is 1; the biggest structure at the Location wins, so two rookeries are not twice a rookery.
  let birdSendsPerDay = null;
  if (raw.birdSendsPerDay != null) {
    const n = Number(raw.birdSendsPerDay);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`${label}: placement.birdSendsPerDay must be a positive integer`);
    }
    birdSendsPerDay = n;
  }
  // Music: what the six-hourly sweep pays a listener (bot/src/lib/stagePlay.js).
  let music = null;
  if (raw.music != null) {
    if (typeof raw.music !== "object" || Array.isArray(raw.music)) {
      throw new Error(`${label}: placement.music must be a mapping`);
    }
    const mood = Number(raw.music.mood);
    // Positive only: relief is never multiplied (MOOD.md §7), so a negative would be a harm term wearing a relief's clothes.
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
    // Positive only: a malus would apply to EVERYONE laboring the ground, and can drag the paid range's floor below zero, where it pays nothing.
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
    // The builder may write a line on the finished thing (Structure.inscription), replacing `examine` in the readout. See CRAFTING.md.
    inscribable: raw.inscribable === true,
  };
}

// `customizable:` — the recipe may be crafted as a player-named custom item (CRAFTING.md; mints via paperMint.js), and `customizableSkill:` is the tag needed to do it (`smithing-skilled` on arms/armour), checked against the catalog like excludedRoles.
// Four rules: not craftable means nothing would mint one; not stackable would dodge the one-per-character checks (craftGrantChecks, tier replacement compare the BASE tag's id, which a minted row never matches); `placement:` is a Structure with its own words (placement.inscribable), not a name to rename.
function validateCustomizable(entry, { slug, knownSlugs = null, label = "docs/tags.yaml" }) {
  // Checked even when the recipe is not customizable, so a leftover `customizableSkill` on a row whose flag came off doesn't sit there gating nothing.
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

// Longer than a taste needs and shorter than a sentence — it drops into the middle of one line a player reads once.
const COOKED_TASTE_MAX = 40;

// What a tag contributes AS AN INGREDIENT, from its `cooked:` block ({ taste, mood, into?, cures? }). The block's presence is the only thing that makes a tag cookable — no `ingredient: true` flag, no per-recipe list.
// `into` omitted means "contribute my own `consumesInto`", looked up when the dish is eaten rather than frozen at cook time. `cures` needs its own hook (medical pass put cures on `Tag.cures`, not `consumesInto`) and defaults OFF: write `cures: true` on a tonic somebody drinks, leave it off anything injected/applied/strapped on. COOKING.md §4-5 has the raw-vs-cooked table. `into` reuses the caller's own consumesInto normalizer (`normalizeInto`).
function normalizeCooked(cooked, { slug, normalizeInto, label = "docs/tags.yaml" }) {
  if (cooked == null) return null;
  if (typeof cooked !== "object" || Array.isArray(cooked)) {
    throw new Error(`${label}: tag "${slug}" cooked must be a block with a taste and a mood`);
  }
  const taste = cooked.taste;
  // The key is required; its VALUE may be empty — an empty taste is the undetectable poison (Phrygian Tears, Adder's Bite), and web/lib/cooking.js drops an empty fragment rather than printing a gap. `taste: ""` is a deliberate claim; an absent `taste:` is a slip.
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
  // A single ingredient past either end is always an authoring slip; clamping silently would hide one. Required lazily so mood.js does not require this file (no cycle).
  const { MOOD_MAX, MOOD_MIN } = require("./mood");
  if (mood > MOOD_MAX || mood < MOOD_MIN) {
    throw new Error(
      `${label}: tag "${slug}" cooked.mood is ${mood} — the dial runs +${MOOD_MAX} to ${MOOD_MIN}`,
    );
  }
  const into = cooked.into == null ? null : normalizeInto(cooked.into);
  // Opt-in, stored only when true — an absent key and `cures: false` are the same claim, so writing false would be noise in every block that never carries a cure.
  if (cooked.cures != null && typeof cooked.cures !== "boolean") {
    throw new Error(
      `${label}: tag "${slug}" cooked.cures must be true or false — it says whether this ingredient's OWN cures list survives the pot, not which cures`,
    );
  }
  const cures = cooked.cures === true;
  // Opt-in, stored only when present — how much this ingredient restores on the 0-30 hunger meter (db/lib/hunger.js). Absent means "not a meaningful food" (foodHungerFor falls back to DEFAULT_FOOD_HUNGER for anything that still grants ate-meal).
  const hunger = cooked.hunger ?? null;
  if (hunger != null && (!Number.isInteger(hunger) || hunger < 0 || hunger > 30)) {
    throw new Error(
      `${label}: tag "${slug}" cooked.hunger must be a whole number from 0 to 30`,
    ); // 30 == HUNGER_MAX, db/lib/hunger.js
  }
  // Opt-in flag: renders the taste as a bare adjective ("It tastes acidic.") instead of the default noun form ("It tastes like X."). Existing tags leave this unset and keep rendering exactly as before — see web/lib/cooking.js.
  if (cooked.tasteForm != null && cooked.tasteForm !== "adjective") {
    throw new Error(
      `${label}: tag "${slug}" cooked.tasteForm must be "adjective" or omitted`,
    );
  }
  const tasteForm = cooked.tasteForm === "adjective" ? "adjective" : null;
  return {
    taste: taste.trim(),
    mood,
    into,
    ...(cures ? { cures: true } : {}),
    ...(hunger != null ? { hunger } : {}),
    ...(tasteForm ? { tasteForm } : {}),
  };
}

// `inlayValue` — TRINKETS.md: what a raw material adds to a minted Trinket's sell price when inlaid (see schema comment on Tag.inlayValue). A positive whole number, or absent.
function normalizeInlayValue(value, { slug, label = "docs/tags.yaml" } = {}) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${label}: tag "${slug}" inlayValue must be a positive whole number`,
    );
  }
  return value;
}

// `cooked` deliberately does NOT require `consumable`: cookable and edible are different claims (nobody gnaws a raw hand, but a hand in a stew can happen). The cooking path reads this block; the consume path never sees it.
// Conversely, an ingredient that does nothing RAW says so with `consumable: true` and an empty `consumesInto` — the honest way to write an onion, keeping "nothing happened" a real answer.
function validateCooked(normalized, { selfSlug, tagSlugs, entry: tagEntry, label = "docs/tags.yaml" }) {
  if (!normalized) return;
  // `cures: true` says "what I cure, I cure through the pot" — nonsense on a tag with nothing to cure, or one whose cure must be FITTED (`administerSkill`: prosthetics, autoinjectors — none of those is a thing you eat).
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

// How many ingredients a recipe takes, from `requirement.ingredientSlots`. A sibling of requirement.items rather than a second `anyOf`: the legal set is "any tag carrying a cooked block", which no authored list could keep up with.
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
  // Same reasoning as requirement.items: the Craft path is the only place slots are ever read.
  if (!craftable) {
    throw new Error(`${label}: tag "${selfSlug}" declares ingredientSlots but is not craftable — nothing would ever check them`);
  }
  if (placement) {
    throw new Error(`${label}: tag "${selfSlug}" declares ingredientSlots and placement — a build site never spends an ingredient`);
  }
  // A multi-turn project mints on the FINISHING turn, days after ingredients were picked; the slugs would have to ride CraftProject.custom to survive the wait, and nothing needs that today.
  if (Number.isInteger(turnsCost) && turnsCost >= 2) {
    throw new Error(
      `${label}: tag "${selfSlug}" declares ingredientSlots on a ${turnsCost}-turn project — the picked slugs would not survive to the finishing turn`,
    );
  }
}

// What a customizable recipe charges for the player's words, and whether it takes a description at all: `{ cost: 0, describable: false }`, legal only beside `customizable: true`. Absent `cost` means the standard surcharge (web/lib/customCraft.js); `0` is the meals.
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

// Catches a placement block on a tag nothing would ever build, and one on a tag that could leave a Location (tradeable/stackable/equippable/carryBonus all mean "on somebody's person", which a Structure never is). `tag` is the raw YAML entry.
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
  // `placement.locations`/`placement.yields.room` name LOCATIONS/ROOMS from docs/zones.yaml's own sync — knownSlugs holds only tag slugs, so a cross-master reference resolves at RUNTIME and must fail soft (SYNC.md); the yield pass logs and skips, the build gate refuses rather than throws.
  // A 0-turn placement would be born finished — a build takes at least one crew-turn, always.
  const turns = tag.requirement?.turnsCost ?? 1;
  if (!Number.isInteger(turns) || turns < 1) {
    throw new Error(
      `${label}: tag "${slug}" declares placement but requirement.turnsCost is ${tag.requirement?.turnsCost} — a structure takes at least 1 crew-turn`,
    );
  }
}

// ─── fighting ───────────────────────────────────────────────────────────────
// The `fighting:` block — what a tag does in a fight (docs/systemdocs/COMBAT.md). db/lib/fightingSkill.js is the read side and trusts this shape.
// The YAML authors TIERS and this stores POINTS: tiers match tag prose ("counts as 2 tiers higher"), points is what the decimal-free running-total arithmetic wants.
const { BANDS, POINTS_PER_TIER, WEAPON_CLASSES } = require("./fightingSkill");

const FIGHTING_TREES = new Set(["melee", "ranged", "both"]);
const FIGHTING_BAND_KEYS = new Set(BANDS.map((b) => b.key));
// `holds` is AND (every slug must be held). `holdsAny` is OR, for a condition spanning rungs of one ladder that replace each other (e.g. "being drunk at all").
const FIGHTING_WHEN_KEYS = new Set(["weaponClass", "holds", "holdsAny", "equipped", "unarmoured"]);

// A tier is authored to one decimal place and nothing finer: `tiers: 0.25` would silently become 2.5 points and round to a value nobody authored.
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

  // Rungs are 1-indexed: Basic is the first rung, not the zeroth (rung 0 says nothing — leave the block off instead).
  if (raw.rung != null) {
    if (!Number.isInteger(raw.rung) || raw.rung < 1) {
      throw new Error(`${label}: fighting.rung must be an integer of at least 1 — Basic is rung 1`);
    }
    out.rung = raw.rung;
  }

  // `tiers` and `points` are the same field in two units; authoring both is refused rather than picked between.
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

  // A FLAG, not a sentence — which moment a tag is for is already in its description. This just says a gamemaster decides, so it never enters the number.
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

// Catches a block that says nothing the resolver will ever read, a condition naming an unknown tag, and an unequippable weapon — each a SILENT no-op at runtime.
function validateFighting(normalized, { selfSlug, tagSlugs, equippable, label = "docs/tags.yaml" }) {
  if (!normalized) return;

  const saysSomething =
    normalized.rung != null ||
    normalized.points != null ||
    normalized.floor ||
    normalized.cap ||
    normalized.weaponClass ||
    // `situational: true` alone is a real answer: Camouflage has no tier or tree, and still must reach the sheet's situational list.
    normalized.situational ||
    normalized.cancels;
  if (!saysSomething) {
    throw new Error(`${label}: "${selfSlug}" fighting has a condition but nothing to apply — add tiers, a floor, or a note`);
  }

  // A shift needs to know which half of the tree it lands on; a weapon's class already answers that.
  if (normalized.points != null && !normalized.tree && !normalized.weaponClass) {
    throw new Error(`${label}: "${selfSlug}" fighting has tiers but no tree — write melee, ranged, or both`);
  }
  if (normalized.weaponClass && normalized.tree) {
    throw new Error(`${label}: "${selfSlug}" fighting names a weaponClass and a tree — the class already decides the tree`);
  }
  if (normalized.weaponClass && !equippable) {
    throw new Error(`${label}: "${selfSlug}" fighting names a weaponClass, but the tag is not equippable — a weapon nobody can draw is worth nothing`);
  }

  // Every condition and cancellation names a real tag; a typo would read as a bonus that never fires.
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
  normalizeRemovesOnConsume,
  validateRemovesOnConsume,
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
