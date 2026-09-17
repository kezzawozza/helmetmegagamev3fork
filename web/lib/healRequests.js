// Pure — no Prisma, no server imports — so the client picker and healCharacterRequest can never disagree.
export { buildSkillAncestry, satisfiedSkillIds, canTreatAsRoutine }from "@lifeweb/db/lib/medicalVision";

export const HEAL_SKILL_SLUG = "medical-basic";

export const HEALABLE_CATEGORY = "Health";

// A Health tag without the catalog's `healable` flag is tier 0 of the cure ladder (docs/systemdocs/TAGS.md §5c) — untreatable.
export function isHealable(tag) {
  return Boolean(tag?.healable);
}

export const INFLICTABLE_GROUPS = new Set(["health-wounds", "health-maiming"]);

export const INFLICTABLE_SLUGS = new Set(["concussed", "shell-shocked", "blind", "mute"]);

export function isInflictable(tag) {
  if (!tag || tag.category !== HEALABLE_CATEGORY || tag.custom) return false;
  return INFLICTABLE_GROUPS.has(tag.group?.slug) || INFLICTABLE_SLUGS.has(tag.slug);
}

export function healCost(tag) {
  return tag?.requirementResources ?? 0;
}

// Every query feeding isGambitHeal()/needsSurgicalSite() must select all three fields, not a subset.
export const HEAL_SKILL_SELECT = { id: true, name: true, slug: true };

function missingSkillsFor(tag, satisfied) {
  return (tag?.requirementSkills ?? []).filter((skill) => !satisfied.has(skill.id));
}

// A failed roll can leave the patient worse (docs/systemdocs/TAGS.md §5c).
export function isGambitHeal(tag, satisfied) {
  if (!tag) return false;
  return Boolean(tag.requirementGambit) || missingSkillsFor(tag, satisfied).length > 0;
}

// Non-minor surgery needs a site (M3, TAGS.md §5c).
export function needsSurgicalSite(tag) {
  return (tag?.requirementSkills ?? []).some((skill) => skill.slug === "medical-expert");
}

// Only a 0-turn cure draws on the medic's shared free pool (M2, TAGS.md §5c).
export function countsAgainstHealCap(tag, gambit = false) {
  return (tag?.requirementTurns ?? 0) === 0 && !gambit;
}

export function healCapFor(heldSlugs, pool) {
  const ladder = ["medical-expert", "medical-skilled", "medical-basic"];
  return ladder.some((slug) => heldSlugs.has(slug)) ? pool : 0;
}

// Saint's Perform Miracle (docs/tags.yaml `saint:`): two free instant cures a
// turn, capped at the cure ladder's Moderate rung — Dead Simple, Simple, or
// Moderate (TAGS.md §5c). No ⬢, no Move, no Medical training needed. Not the
// medic's MEDICAL_SIMPLE_PER_TURN pool — its own count on the AuditLog.
export const SAINT_SLUG = "saint";
export const MIRACLE_PER_TURN = 2;

// A healable tag qualifies for a miracle when it sits at tier 1–3 on the cure
// ladder (Dead Simple, Simple, Moderate — TAGS.md §5c). The ⬢ column is what
// tells the three rungs apart from the ones above them: tier 1 costs 1 ⬢, tiers
// 2 and 3 cost 2 ⬢, and every rung from Severe up costs 4 ⬢ or more. So
// requirementResources ≤ 2 is the whole ceiling — Grievous Wound (7 ⬢) and the
// surgical rungs are excluded automatically. A Gambit rung is refused outright
// too — a miracle is instant, not a roll.
export function isMiracleable(tag) {
  if (!isHealable(tag)) return false;
  if (tag?.requirementGambit) return false;
  const cost = tag?.requirementResources ?? 0;
  return cost > 0 && cost <= 2;
}
