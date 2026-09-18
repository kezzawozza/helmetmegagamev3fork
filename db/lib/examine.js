// The ONE readout behind the 🔍 reaction and the Examine button — one shared
// module rather than the twin-drift ARCHITECTURE.md §3 warns about. Pure and
// Prisma-free; can't query the subject's last Desire or doctor's-eye skill
// catalog itself, both come in as arguments. `subject` may be an assembled snapshot (db/lib/examineSnapshot.js).
const { concealedLine } = require("./concealedIdentity");
const { THANATI_SLUG, THANATI_LEADER_SLUG } = require("./thanati");
const { formatTagRequirement } = require("./formatTagRequirement");
const { formatTagArmor } = require("./formatTagArmor");
const { tagDisplayName } = require("./tagDisplayName");
const { ARMOR_TAG_FIELDS } = require("./armorValue");
const { inspectVision } = require("./inspectVision");
const {
  HEALTH_CATEGORY,
  medicallyVisibleTags,
  seenByBystander,
} = require("./medicalVision");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { turnsLeft, formatTurnsLeft } = require("./turnFormat");
const { revealedTags } = require("./torture");
const { withoutResources, isResourcesRow } = require("./resourceStack");

// TAG half split out for db/lib/examineSnapshot.js — name/armour/requirement are RULES, read live even for an old look.
const EXAMINE_TAG_SELECT = {
  name: true,
  slug: true,
  category: true,
  inspectVisibility: true,
  forcedName: true,
  ...CONCEALMENT_TAG_FIELDS,
  requirementGambit: true,
  requirementTurns: true,
  requirementPerTurn: true,
  requirementResources: true,
  requirementItems: true,
  requirementSkills: { select: { id: true, name: true } },
  ...ARMOR_TAG_FIELDS,
};

const EXAMINE_SUBJECT_SELECT = {
  id: true,
  name: true,
  appearance: true,
  concealed: true,
  age: true,
  gender: true,
  updatedAt: true,
  tags: {
    select: {
      equipped: true,
      // ⬢ are one of these rows now, not a column on the character, so the
      // officer's line below counts them off the tag set — which needs the
      // quantity.
      quantity: true,
      tag: { select: EXAMINE_TAG_SELECT },
      expiresTurn: true,
    },
  },
};

// `viaSkill` marks a row the subject is NOT showing the room, rendered "your diagnosis" so a medic doesn't repeat it as common knowledge.
function describeTag({ characterTag: ct, viaSkill }, openTurnNumber) {
  const bits = [
    ct.tag.category === HEALTH_CATEGORY ? formatTagRequirement(ct.tag) : null,
    formatTagArmor(ct.tag),
    formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurnNumber)),
    viaSkill ? "your diagnosis" : null,
  ].filter(Boolean);
  return {
    name: tagDisplayName(ct.tag),
    slug: ct.tag.slug ?? null,
    detail: bits.length > 0 ? bits.join(" · ") : null,
    viaSkill: Boolean(viaSkill),
  };
}

function thanatiLines(subjectTags = []) {
  const slugs = new Set(subjectTags.map((ct) => ct.tag?.slug));
  if (!slugs.has(THANATI_SLUG)) return [];
  const seat = subjectTags.find((ct) => ct.tag?.slug === (slugs.has(THANATI_LEADER_SLUG) ? THANATI_LEADER_SLUG : THANATI_SLUG));
  return [{ name: seat.tag.name, slug: seat.tag.slug, detail: null, viaSkill: false }];
}

// Built BEFORE normal field logic. Hood hides identity not inventory; no appearance/name/Desire regardless of viewer gates.
function concealedReadout(identity, subject) {
  const seen = (subject.tags ?? []).filter((ct) => seenByBystander(ct.tag, ct, false));
  const isHealth = (ct) => ct.tag.category === HEALTH_CATEGORY;
  return {
    concealed: true,
    name: identity.name,
    avatarPath: identity.avatarPath,
    line: concealedLine(identity.alias),
    appearance: null,
    ailments: seen.filter(isHealth).map((ct) => ct.tag.name),
    // ⬢ are left out. The catalog already hides them (`visible: false` on
    // `resources`, same as `obol`), so nothing reaches here today — this is
    // the belt to that flag's braces, and it is worth keeping because the rule
    // is not really about visibility: a bare "Resources" chip would announce to
    // any passer-by that there is a balance worth taking.
    equipment: withoutResources(seen.filter((ct) => !isHealth(ct))).map((ct) => ct.tag.name),
    tags: [],
    desire: null,
  };
}

// `lastDesire` queried only when `canSeeDesire(viewerTags)` says it will render.
function examineReadout({
  subject,
  viewerTags = [],
  satisfied = new Set(),
  openTurnNumber,
  lastDesire = null,
  wasConcealedAs = null,
  // A Thanati sees whether the subject is one too (THANATI.md); HIDDEN otherwise.
  viewerIsThanati = false,
}) {
  const identity = presentedIdentity(subject, {
    forcedName: forcedNameFrom(subject.tags),
    concealment: concealmentFrom(subject.tags),
  });
  // MOMENT answer (🔍/📸): a since-unmasked subject would be exposed retroactively — caller-passed alias wins outright.
  if (wasConcealedAs && !identity.concealed) {
    return concealedReadout({ ...identity, name: wasConcealedAs, alias: wasConcealedAs }, subject);
  }
  // `concealed` is false for a forced name (Apex Form) — being something else, not hiding.
  if (identity.concealed) return concealedReadout(identity, subject);

  // A Disguise Kit is a false name over an unhidden face — the NAMED tag comes off here too, or a wanted man could wear it and still show as Wanted.
  const identityVisible = !identity.forced;

  const { canSeeDesire } = inspectVision(viewerTags);
  return {
    concealed: false,
    name: identity.name,
    avatarPath: identity.avatarPath,
    line: null,
    appearance: subject.appearance || null,
    ailments: [],
    equipment: [],
    tags: [
      // Same rule as the bystander readout above, and likewise a no-op while
      // the catalog hides ⬢. It stays because it is what stops a reader seeing
      // a "Resources" chip at all the day somebody makes the stack visible
      // again — what somebody is holding is nobody else's to count.
      ...medicallyVisibleTags(subject.tags, satisfied, identityVisible)
        .filter((entry) => !isResourcesRow(entry.characterTag))
        .map((entry) => describeTag(entry, openTurnNumber)),
      ...(viewerIsThanati ? thanatiLines(subject.tags) : []),
    ],
    // ABSENT, never "hidden" — a viewer without sight and nothing-to-read look the same.
    desire: canSeeDesire ? { text: lastDesire?.text ?? null, points: lastDesire?.points ?? null } : null,
    // No role title and no ⬢ figure, for anybody. Both used to ride on sharing
    // a faction — a role title with whoever answered to the same name, a
    // balance with that faction's officers — and with factions gone there is
    // no reader left who is entitled to either. A GM reads both off the desk.
  };
}

function canSeeDesire(viewerTags = []) {
  return inspectVision(viewerTags).canSeeDesire;
}

// True name and face, on purpose — reads Character.name/avatar directly
// rather than through presentedIdentity. Wounds/statuses are db/lib/torture.js's business, not this file's.
function tortureReadout({ subject, openTurnNumber }) {
  return {
    name: subject.name,
    avatarPath: `/api/avatar/${subject.id}?v=${subject.updatedAt?.getTime?.() ?? 0}`,
    tags: revealedTags(subject.tags).map((ct) => describeTag({ characterTag: ct, viaSkill: false }, openTurnNumber)),
  };
}

module.exports = { EXAMINE_TAG_SELECT, EXAMINE_SUBJECT_SELECT, examineReadout, canSeeDesire, tortureReadout };
