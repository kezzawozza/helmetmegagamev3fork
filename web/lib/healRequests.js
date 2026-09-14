// What a medic can treat, and whether they're qualified to treat it.
//
// Deliberately pure — no Prisma, no server imports — because the client picker
// and the server action must agree: an affliction the dialog offers must be one
// healCharacterRequest will actually accept, and one it greys out must be one
// the action refuses. Same posture as consumeGrants.js.
//
// Tag.requirement* is documented in schema.prisma as covering "whichever
// direction is narratively relevant" — crafting reads it as the cost to gain a
// tag, healing as the cost to shed one. This module is the healing reading.

// The skill-tier walk lives in db/lib now, because the bot needs it too: the
// doctor's eye on 🔍-inspect asks the same "are you qualified for this?"
// question this module asks. Re-exported so every existing caller here keeps
// importing from where it always did.
export { buildSkillAncestry, satisfiedSkillIds, canTreatAsRoutine }from "@lifeweb/db/lib/medicalVision";

export const HEAL_SKILL_SLUG = "medical-basic";

// Health is its own category, split out of Status — Status is the
// needs/intoxication layer (Hungry, Drained, Tipsy) and afflictions are a
// system of their own. Tag.category stores the display name, not the YAML
// slug (see syncTags.js), which is why this is capitalised. Harm's menu still
// reads the category (isInflictable below); Heal's does not.
export const HEALABLE_CATEGORY = "Health";

// What Heal lists: the catalog's own `healable` flag (docs/tags.yaml), set on
// every affliction with a cure. A Health tag without it is tier 0 of the cure
// ladder (docs/systemdocs/TAGS.md §5c): something realistically untreatable
// that runs its own short course — Vomiting, a Migraine, a Concussion. It
// used to be derived from the category plus a requirement block; the flag
// replaced that so the menu is data, not a heuristic.
export function isHealable(tag) {
  return Boolean(tag?.healable);
}

// What one person can do to another with their hands. Harm used to offer the
// whole Health category — all 75 rows — which is how a player could stand over
// a Bound character and give them Exploded Chest ("a larva slithered out"),
// Appendicitis, or Hungover.
//
// The category is not a menu of attacks. Most of it is downstream of one:
// health-recovery is the aftermath a treatment leaves (Stitched Up, Splinted),
// health-infection is what the engine grants when a wound goes untended
// (Festering, Sepsis, Dying), health-illness is disease, and health-minor is
// mostly jokes. None of those is a thing you do to someone.
//
// Two groups are: health-wounds and health-maiming. Everything you can inflict
// by hand lives in one of them.
export const INFLICTABLE_GROUPS = new Set(["health-wounds", "health-maiming"]);

// Four out of health-mind that a beating plainly can cause, named one by one
// because the rest of that group (Amnesiac, Lunatic, Hallucinating, Night
// Blind, Stutter, Silence) cannot be. Paralyzed is deliberately absent: it is
// in INCAPACITATING_SLUGS, so inflicting it would let one player lock another
// out of their day's labor indefinitely, at will.
export const INFLICTABLE_SLUGS = new Set(["concussed", "shell-shocked", "blind", "mute"]);

// The picker and harmCharacterRequest both call this, for the reason this
// whole module is pure: an injury the dialog offers must be one the action
// accepts. `custom` keeps GM-authored tags out — the Harm menu is the catalog,
// not whatever a GM wrote for one scene.
export function isInflictable(tag) {
  if (!tag || tag.category !== HEALABLE_CATEGORY || tag.custom) return false;
  return INFLICTABLE_GROUPS.has(tag.group?.slug) || INFLICTABLE_SLUGS.has(tag.slug);
}

// null means free, not "unpriced" — the payer is still recorded either way.
export function healCost(tag) {
  return tag?.requirementResources ?? 0;
}

// What a `requirementSkills` row has to carry for the predicates below to
// answer correctly. Every query whose tags reach isGambitHeal() or
// needsSurgicalSite() must select THIS, not a subset: `name` alone renders a
// correct requirement label while silently breaking both — a row with no `id`
// matches nothing in `satisfied`, so every cure reads as a Gambit, and a row
// with no `slug` never matches medical-expert, so surgery stops asking for a
// site. Neither failure is visible in the label the player reads beside it.
export const HEAL_SKILL_SELECT = { id: true, name: true, slug: true };

// The requirementSkills rows still missing — [] when qualified.
function missingSkillsFor(tag, satisfied) {
  return (tag?.requirementSkills ?? []).filter((skill) => !satisfied.has(skill.id));
}

// Would treating this be a GAMBIT rather than a routine?
//
// Two ways it can be. Reaching above your tier is the obvious one — a nurse
// opening a belly — and the catalog's own `requirementGambit` is the other:
// the top rung of the cure ladder is a roll even for Esculap, which is what
// separates tier 7 from tier 6, since they share a price.
//
// Nothing is refused for being out of reach any more. A medic may ATTEMPT
// anything they can see; what changes is whether they roll for it, and a
// failed roll can leave the patient worse (docs/systemdocs/TAGS.md §5c).
export function isGambitHeal(tag, satisfied) {
  if (!tag) return false;
  return Boolean(tag.requirementGambit) || missingSkillsFor(tag, satisfied).length > 0;
}

// Non-minor surgery needs a site (M3, TAGS.md §5c) — the medical mirror of
// needsWorkshop's forge rule (web/lib/tagRequests.js, SMITHING.md §2a). Tier
// 6 and 7 are the two rungs the cure ladder prices on Medical (Expert); tier
// 5 ("very minor surgery") stays site-free. Read off the CURE's own
// required skill, not the treating medic's — a Skilled medic reaching above
// their tier for a tier-6/7 cure still needs the site, same as an Expert
// doing it as routine work. Pure and shared, so the dialog and the server
// cannot disagree.
export function needsSurgicalSite(tag) {
  return (tag?.requirementSkills ?? []).some((skill) => skill.slug === "medical-expert");
}

// Does this cure draw on the medic's shared free pool (M2,
// docs/systemdocs/TAGS.md §5c)? Only a 0-turn cure does — a turns-costing
// cure is billed the Move's own fraction instead (CRAFTING.md §2a) and
// never touches this pool at all. See MEDICAL_SIMPLE_PER_TURN in
// web/lib/requests.js. The 0-turn half of the check is INVERTED from the
// pre-M2 predicate (`turns > 0`), which counted turn-costing cures against
// a per-tier daily cap — that cap is gone, replaced by the Move economy.
//
// `gambit` is defense-in-depth here, not load-bearing (review fix, round
// 3): both current callers already exclude a Gambit before this ever runs
// — a Gambit files a Move of its own and never reaches the pool question at
// all — so the parameter mostly guards a future caller that forgets to,
// rather than changing today's answer.
export function countsAgainstHealCap(tag, gambit = false) {
  return (tag?.requirementTurns ?? 0) === 0 && !gambit;
}

// The medic's own allowance: MEDICAL_SIMPLE_PER_TURN if they hold any
// medical tier at all, 0 otherwise (M2 dropped the old per-tier scaling — an
// Expert's edge is the Move fractions they can afford on turns-costing cures,
// not a bigger free pool).
//
// `heldSlugs` is a Set of the character's tag slugs; `pool` is
// MEDICAL_SIMPLE_PER_TURN, passed in so this module stays free of that
// import. Unlike `canHeal` (satisfiedSkillIds' ancestry walk, which is what
// the server actually gates on), this checks the three tier slugs literally
// — today's catalog has no other medical tier, so the two answers agree, but
// a future tier the ladder doesn't literally name would make this the
// STRICTER of the two: it could show 0 healsLeft for a medic the server
// would still let treat. Fails closed, not open, but it is a real gap, not
// a guarantee the client and server can never disagree.
export function healCapFor(heldSlugs, pool) {
  const ladder = ["medical-expert", "medical-skilled", "medical-basic"];
  return ladder.some((slug) => heldSlugs.has(slug)) ? pool : 0;
}
