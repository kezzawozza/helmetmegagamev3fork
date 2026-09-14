// What a medic can treat and whether they're qualified. Deliberately pure — no Prisma, no server
// imports — so the client picker and healCharacterRequest can never disagree (like consumeGrants.js).
// Tag.requirement* covers "whichever direction is narratively relevant" (schema.prisma); this module
// is the healing reading of it.

// The skill-tier walk lives in db/lib (the bot's 🔍-inspect doctor's eye needs it too); re-exported
// so existing callers here keep importing from the same place.
export { buildSkillAncestry, satisfiedSkillIds, canTreatAsRoutine }from "@lifeweb/db/lib/medicalVision";

export const HEAL_SKILL_SLUG = "medical-basic";

// Health is split out of Status (needs/intoxication) as its own category. Tag.category stores the
// display name, not the YAML slug (syncTags.js), hence the capitalisation.
export const HEALABLE_CATEGORY = "Health";

// What Heal lists: the catalog's own `healable` flag (docs/tags.yaml). A Health tag without it is
// tier 0 of the cure ladder (docs/systemdocs/TAGS.md §5c) — untreatable, runs its own short course.
export function isHealable(tag) {
  return Boolean(tag?.healable);
}

// What one person can do to another with their hands. Not the whole Health category — most of it
// (health-recovery, health-infection, health-illness, health-minor) is not a thing you do to someone.
// Only health-wounds and health-maiming are inflictable by hand.
export const INFLICTABLE_GROUPS = new Set(["health-wounds", "health-maiming"]);

// The four out of health-mind a beating can plainly cause. Paralyzed is deliberately absent — it's
// in INCAPACITATING_SLUGS, so inflicting it would let one player lock another out of labor at will.
export const INFLICTABLE_SLUGS = new Set(["concussed", "shell-shocked", "blind", "mute"]);

// Used by both the picker and harmCharacterRequest, for the pure-module reason above. `custom` keeps
// GM-authored tags out — the Harm menu is the catalog, not whatever a GM wrote for one scene.
export function isInflictable(tag) {
  if (!tag || tag.category !== HEALABLE_CATEGORY || tag.custom) return false;
  return INFLICTABLE_GROUPS.has(tag.group?.slug) || INFLICTABLE_SLUGS.has(tag.slug);
}

// null means free, not "unpriced" — the payer is still recorded either way.
export function healCost(tag) {
  return tag?.requirementResources ?? 0;
}

// Every query feeding isGambitHeal()/needsSurgicalSite() must select all three fields, not a subset:
// missing `id` makes every cure read as a Gambit; missing `slug` stops surgery asking for a site.
export const HEAL_SKILL_SELECT = { id: true, name: true, slug: true };

// The requirementSkills rows still missing — [] when qualified.
function missingSkillsFor(tag, satisfied) {
  return (tag?.requirementSkills ?? []).filter((skill) => !satisfied.has(skill.id));
}

// Would treating this be a GAMBIT rather than routine? Either reaching above your tier, or the
// catalog's own `requirementGambit` (the top cure-ladder rung is a roll even for Esculap — what
// separates tier 7 from tier 6). Nothing is refused for being out of reach; a failed roll can leave
// the patient worse (docs/systemdocs/TAGS.md §5c).
export function isGambitHeal(tag, satisfied) {
  if (!tag) return false;
  return Boolean(tag.requirementGambit) || missingSkillsFor(tag, satisfied).length > 0;
}

// Non-minor surgery needs a site (M3, TAGS.md §5c) — the medical mirror of needsWorkshop's forge rule
// (web/lib/tagRequests.js, SMITHING.md §2a). Read off the CURE's own required skill, not the treating
// medic's, so reaching above your tier still needs the site.
export function needsSurgicalSite(tag) {
  return (tag?.requirementSkills ?? []).some((skill) => skill.slug === "medical-expert");
}

// Does this cure draw on the medic's shared free pool (M2, TAGS.md §5c)? Only a 0-turn cure does; a
// turns-costing cure is billed the Move's own fraction instead (CRAFTING.md §2a). `gambit` is
// defense-in-depth: both current callers already exclude a Gambit before this runs.
export function countsAgainstHealCap(tag, gambit = false) {
  return (tag?.requirementTurns ?? 0) === 0 && !gambit;
}

// The medic's own allowance: MEDICAL_SIMPLE_PER_TURN if they hold any medical tier, 0 otherwise.
// `heldSlugs` is a Set of tag slugs; `pool` is passed in so this module stays import-free. Unlike
// `canHeal` (the ancestry walk the server actually gates on), this checks the three tier slugs
// literally — stricter than the server for a future tier the ladder doesn't name, not looser.
export function healCapFor(heldSlugs, pool) {
  const ladder = ["medical-expert", "medical-skilled", "medical-basic"];
  return ladder.some((slug) => heldSlugs.has(slug)) ? pool : 0;
}
