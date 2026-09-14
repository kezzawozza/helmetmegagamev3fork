// Who is qualified to treat what, and — because of that — who can SEE what.
// 🔍-inspecting someone shows you the ailments YOU could treat as routine,
// even ones nobody else can see. Same posture as inspectVision.js: no Prisma
// import, required by subpath from both bot/ and web/. web/lib/healRequests.js
// re-exports the two ancestry helpers so its callers keep importing from
// where they always did.

// Tag.parentTagId is the replacing tier chain (Medical Basic -> Skilled ->
// Expert). A higher tier must satisfy a requirement written against a lower
// one, or a surgeon couldn't do a nurse's job. `tags` is the flat catalog as
// [{ id, parentTagId }]; result maps a tag id to itself plus every ancestor.
// Cycle-guarded, since nothing in the schema stops a chain looping back.
function buildSkillAncestry(tags) {
  const parentOf = new Map((tags ?? []).map((t) => [t.id, t.parentTagId ?? null]));
  const ancestry = new Map();
  for (const id of parentOf.keys()) {
    const seen = new Set();
    let cursor = id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    ancestry.set(id, seen);
  }
  return ancestry;
}

// Every skill the character counts as having: what they hold, plus everything
// those tags are an upgrade of.
function satisfiedSkillIds(heldTagIds, ancestry) {
  const satisfied = new Set();
  for (const id of heldTagIds ?? []) {
    for (const ancestorId of ancestry.get(id) ?? [id]) satisfied.add(ancestorId);
  }
  return satisfied;
}

// Health category's display name, as stored in Tag.category (syncTags writes
// the display name, not the YAML slug).
const HEALTH_CATEGORY = "Health";

// Can a bystander see this tag on this character at all? The plain vision
// gate, before medical reasoning layers exceptions on top. Four states
// (Tag.inspectVisibility): never, always, only while equipped, or only while
// the subject is going under their own name. NAMED is a reputation rather
// than a thing — a hood or false name takes it off the read.
// `identityVisible` defaults TRUE so no existing caller changes behaviour by
// not passing it. `tag` needs inspectVisibility; `characterTag` needs equipped.
function seenByBystander(tag, characterTag, identityVisible = true) {
  if (tag?.inspectVisibility === "ALWAYS") return true;
  if (tag?.inspectVisibility === "NAMED") return Boolean(identityVisible);
  if (tag?.inspectVisibility === "WORN") return Boolean(characterTag?.equipped);
  return false;
}

// "Could this character treat that affliction without rolling for it?" A
// Gambit is by definition NOT routine, so a tier-7 affliction stays hidden
// even from an Expert who could attempt it. A tag with no requirementSkills
// is nobody's professional business. `tag` needs requirementSkills (at least
// { id }) and requirementGambit.
function canTreatAsRoutine(tag, satisfied) {
  const skills = tag?.requirementSkills ?? [];
  if (skills.length === 0 || tag.requirementGambit) return false;
  return skills.every((skill) => satisfied.has(skill.id));
}

// What an inspector sees of a subject's tags, and why. Returns rows to show
// as { characterTag, viaSkill } — `viaSkill` true when shown ONLY because the
// inspector is qualified, so callers can avoid repeating it as common
// knowledge. `satisfied` is satisfiedSkillIds() for the INSPECTOR;
// `identityVisible` passes straight through to seenByBystander.
function medicallyVisibleTags(characterTags = [], satisfied = new Set(), identityVisible = true) {
  const out = [];
  for (const ct of characterTags) {
    const tag = ct?.tag;
    if (!tag) continue;
    if (seenByBystander(tag, ct, identityVisible)) {
      out.push({ characterTag: ct, viaSkill: false });
      continue;
    }
    // Only afflictions — a doctor's training says nothing about whether someone is secretly a Demoness.
    if (tag.category !== HEALTH_CATEGORY) continue;
    if (canTreatAsRoutine(tag, satisfied)) out.push({ characterTag: ct, viaSkill: true });
  }
  return out;
}

module.exports = {
  HEALTH_CATEGORY,
  buildSkillAncestry,
  satisfiedSkillIds,
  canTreatAsRoutine,
  seenByBystander,
  medicallyVisibleTags,
};
