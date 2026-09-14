import { prisma } from "@lifeweb/db";
import { FIGHTING_TAG_FIELDS } from "@lifeweb/db/lib/fightingSkill";
import {
  isPaper,
  paperDescription,
  paperDescriptionGm,
  paperView,
  paperViewGm,
} from "@lifeweb/db/lib/paper";
import { APPRAISAL_SLUG } from "@lifeweb/db/lib/appraisal";
import { appraise } from "@/lib/appraisal";

// ONE PLACE THAT TURNS A TAG ROW INTO A CHIP.
//
// TagChip/TagDetails (web/app/components) draw the same block everywhere a tag
// is shown — the sheet, the store, the Depot, the tag catalog, the GM desks —
// and they need one shape to do it: TAG_CHIP_FIELDS, plus a `paper` composed
// for the reader. Before this module, four surfaces on /chat each hand-wrote a
// narrow select of their own and each drew their own flat chip from it, so the
// room stash could show a description the GM rail could not, and neither could
// show what a letter said.
//
// referenceData.js#getVisibleTags does the same job for the whole catalog and
// now shares this composer, so the catalog and the rails cannot drift.
//
// THE RULE THIS MODULE EXISTS TO HOLD: `Tag.paperText` NEVER reaches a
// browser. A letter's text is private to its reader (db/lib/paper.js), and
// `description` is published to everybody. So composeChipTag destructures
// paperText off in BOTH branches, unconditionally — paper or not, readable or
// not. That is deliberately structural rather than a strip somebody remembers
// to run: the strips it replaced fired only when the column was non-null, or
// only inside an isPaper branch, and both were one careless `include` away
// from publishing every letter in the game.

// The tag list is not the whole catalog: a tag whose group carries a
// requiredTag sits in a hidden category (Demoness — TAGS.md §3),
// withheld unless the caller's own character has unlocked it. Gating is on
// the GROUP gate only — a tag's own requiredTag stays visible so
// {tag:ranged-archer} references still work for players who haven't bought it.
//
// The reverse of a Desire's tag gate: which Desires this tag OPENS. Read from
// the two UNLOCK relations only — `desireForbiddenBy` (requiresNotTags) is the
// locking half and never renders (web/lib/desireUnlocks.js says why).
//
// A separate export because FOUR queries load the catalog with four
// hand-written selects — this module, pointBuyCatalog.js, /documents and
// /gm/dev/tags — and a tooltip section that silently renders nothing on one of
// them is exactly the drift TAG_CHIP_FIELDS exists to prevent. Spread it, do
// not retype it.
//
// Deliberately four columns and a `retired` filter rather than the whole
// template: TAG_CHIP_FIELDS is also read by /gm/turns (web/lib/moveRows.js),
// so this rides along on the busiest tag query in the app. 274 templates
// exist, ~66 tags carry any unlock at all, and every other row comes back
// empty.
export const DESIRE_UNLOCK_SELECT = {
  desireRequiredBy: {
    where: { retired: false },
    select: {
      slug: true,
      name: true,
      tier: true,
      // Both needed to tell "tag AND role" from "tag OR role" — see
      // desireUnlocks.js#rolesNote, which is the one place that logic lives.
      requiresAnyOf: true,
      requiresAnyRoleSlugs: true,
    },
    orderBy: [{ tier: "desc" }, { name: "asc" }],
  },
  desireAllRequiredBy: {
    where: { retired: false },
    select: {
      slug: true,
      name: true,
      tier: true,
      // The co-requirements, so the row can say "with Butcher".
      requiresAllTags: { select: { slug: true, name: true } },
    },
    orderBy: [{ tier: "desc" }, { name: "asc" }],
  },
};

// ~940 of the ~1000 tags in the catalog unlock no Desire at all, and Prisma
// returns `[]` for each of them on both relations. Left in, that is about
// 27KB of `"desireRequiredBy":[]` shipped to every browser on every page —
// measured, not guessed — for information that is the absence of information.
// desireUnlocksFor() already treats a missing key and an empty array the same,
// so dropping them changes nothing but the wire.
export function stripEmptyUnlocks(tag) {
  if (tag.desireRequiredBy?.length || tag.desireAllRequiredBy?.length) return tag;
  const { desireRequiredBy, desireAllRequiredBy, ...rest } = tag;
  return rest;
}

// The same bargain stripEmptyUnlocks makes, for the weight pair. Barely a
// third of the catalog carries a weight at all (226 of 629 rows when this was
// written); on the rest the two columns ship `"weightLbs":null,
// "tradeable":false` to every browser on every page to say nothing.
// formatTagWeight() reads a stripped tag as weightless, which is the same
// answer it would have given.
export function stripWeightless(tag) {
  if (tag.tradeable && tag.category !== "Assets" && (tag.weightLbs ?? 0) > 0) return tag;
  const { weightLbs, tradeable, ...rest } = tag;
  return rest;
}

// Exactly the Tag columns TagChip reads. Shared so every TagChip caller
// (this module, /gm/turns) uses the same shape instead of a copy that drifts.
// Cooking (docs/systemdocs/COOKING.md). A cook is told what an ingredient
// TASTES of and nothing else — not its mood, not what it will do to whoever
// eats it. You learn an ingredient by using it, and poisoning somebody is
// meant to be a gamble the poisoner takes too (Bascinet, 2026-09-09).
//
// Prisma cannot select one key out of a Json column, so the whole `cooked`
// block comes back and is cut down here, on the server, before it crosses.
// Shipping it whole would put every mood figure and every hidden effect one
// dev-tools inspection away, which is the entire secret.
//
// `Tag.cookedFrom` is dropped outright by the same pass, and is not in
// TAG_CHIP_FIELDS either: a dish says what it tastes of and never what it was
// made with. It is cut here as well as left out of the select because the
// character sheet loads its held tags with a bare `include: { tag: … }`,
// which takes every column there is — a rule that lives only in a select is
// a rule the next `include` quietly breaks.
export function cookedTasteOnly(tag) {
  if (!tag?.cooked && !tag?.cookedFrom?.length) return tag;
  const { cooked, cookedFrom, ...rest } = tag;
  return cooked ? { ...rest, cooked: { taste: cooked.taste ?? "" } } : rest;
}

export const TAG_CHIP_FIELDS = {
  id: true,
  slug: true,
  name: true,
  // ChipLabel draws the mastery star off this. Drop it and the star silently
  // stops appearing on every chip in the app rather than erroring anywhere.
  mastery: true,
  // Read and cut down to its taste by cookedTasteOnly before it ships — see
  // above. Every caller that spreads TAG_CHIP_FIELDS must map through it.
  cooked: true,
  description: true,
  pointCost: true,
  category: true,
  // Drives TagChip's "Requires" line. A caller gating to what the viewer
  // holds must filter group-gated tags itself — the name would tip off
  // anyone else.
  requiredTagId: true,
  requiredTag: { select: { name: true } },
  group: {
    select: {
      slug: true,
      name: true,
      color: true,
      requiredTagId: true,
      requiredTag: { select: { name: true } },
    },
  },
  removable: true,
  craftable: true,
  customizable: true,
  healable: true,
  teachable: true,
  // Minified via formatTagRequirement wherever a description renders.
  // requirementPerTurn is what tells a `turnsCost: 1/N` cure apart from a
  // flat "1 turn" (review fix, M2 — the Tag Catalog showed the wrong number
  // for every fraction-priced medical cure without it).
  requirementTurns: true,
  requirementPerTurn: true,
  requirementResources: true,
  requirementGambit: true,
  requirementSkills: { select: { id: true, slug: true, name: true } },
  // The ingredients ("uses Cave Fungus" / "needs a corpse to hand"). Without
  // this the Tag Catalog's Recipe line silently renders none — the exact
  // failure CORPSES.md §8 warns about, and the line the craft menu's
  // ingredient-hiding rule leans on ("the catalog still teaches the recipe").
  // Redacted per viewer in getVisibleTags() before it ships — see below.
  requirementItems: true,
  // Only so getVisibleTags can build the redaction's visibility set; this
  // payload itself is NOT filtered by it (render-side hiding is this
  // surface's model, the group-key filter below aside).
  catalogVisibility: true,
  // A prose {tag:…} reference has no live expiresTurn, so this is the only
  // way to tell a reader how long the tag would last (TagChip.js).
  defaultDurationTurns: true,
  // What the tag turns into when its duration runs out (untreated-wound
  // chain); TagChip renders it as "Becomes".
  expiresInto: true,
  // Drives TagChip's "Seen by others" line (Tag.inspectVisibility).
  inspectVisibility: true,
  // TagChip's "Armour" line, via formatTagArmor. Both halves, always: a chip
  // that showed only the strong number would hide the fact a breastplate is
  // paper against a rifle, which is the one thing that line exists to say.
  meleeArmor: true,
  ballisticArmor: true,
  // What the tag does in a fight, for TagChip's "In a fight" line and for the
  // GM inspector's Fighting fact, which resolves a whole character off these
  // rows. equipSlot rides along because that resolution asks whether a body
  // slot is filled (Flamboyant) and whether a weapon is drawn.
  ...FIGHTING_TAG_FIELDS,
  // TagChip's "Worn" line, via describeEquipFit. All THREE columns or the line
  // lies: FIGHTING_TAG_FIELDS brings equipSlot only, and without these two the
  // helper reads `undefined` for both — so every two-hander in the catalog said
  // "Held · takes one" (22 of them) and every layered piece said bare "Head"
  // instead of "Head · Liner" (52 of them), which is the single fact that line
  // exists to carry. The same shape of gap as the armour columns above, found
  // 2026-09-10.
  equipLayer: true,
  twoHanded: true,
  // TagChip's "Weight" line, via formatTagWeight. Both halves: an untradeable
  // tag weighs nothing against the cap no matter what the column says, so a
  // weight shown without `tradeable` would contradict the sheet's total.
  weightLbs: true,
  tradeable: true,
  // Drives TagChip's "Conceals you" line. Both, not just the first: the row
  // has to say whether the wearer keeps a choice, and concealsIdentity alone
  // cannot tell you that.
  concealsIdentity: true,
  forcesConceal: true,
  // Drives TagChip's "Unlocks" section.
  ...DESIRE_UNLOCK_SELECT,
};

// Appraisal's raw input (web/lib/appraisal.js's "Worth" line). Deliberately
// NOT folded into TAG_CHIP_FIELDS above: that select is also spread by GM
// surfaces (moveRows.js, peoplePools.js, the /gm/turns desk) that never call
// appraise() on their rows, and shipping sellablePrice there unappraised
// would leak the raw ⬢/obol number to every browser regardless of whether the
// viewer holds the skill. Callers that DO run appraise() spread this in
// alongside TAG_CHIP_FIELDS.
export const APPRAISAL_SELECT = { sellablePrice: true };

// A paper's text NEVER travels in `description` — that column goes to every
// signed-in browser, so a letter sitting in it would be published to everyone
// playing. These three columns are read here, resolved against this viewer,
// and dropped before anything reaches the client.
export const PAPER_FIELDS = { paperKind: true, paperText: true, sealMark: true };

// Everything a chip's tooltip draws, plus the three private paper columns the
// composer resolves and throws away. APPRAISAL_SELECT rides along because
// every caller here runs appraise(), which always drops the raw column.
export const CHIP_ROW_SELECT = {
  ...TAG_CHIP_FIELDS,
  ...PAPER_FIELDS,
  ...APPRAISAL_SELECT,
};

// What a character's own tags look like to the reading gate. Sun Sensitivity
// depends on the clock, so the open turn's phase comes too; slugs and
// `equipped` as well as ids, because the gate asks about eyes — blind, blind
// drunk, nearsighted with the spectacles left in a sack (db/lib/reading.js).
export const CHIP_VIEWER_SELECT = {
  tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true } } } },
  location: { select: { indoors: true } },
};

async function openTurnPhase() {
  const turn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    orderBy: { number: "desc" },
    select: { phase: true },
  });
  return turn?.phase ?? null;
}

// The reader half of the context, built from a character selected with
// CHIP_VIEWER_SELECT. `null` is a legitimate argument — a signed-out caller or
// a GM — and yields a viewer holding nothing, which the gate reads as unable
// to read. That is the safe direction.
async function chipViewerFor(character) {
  return {
    tags: character?.tags ?? [],
    phase: await openTurnPhase(),
    indoors: character?.location?.indoors ?? true,
  };
}

// The whole context in one call, for the common case: one character, their own
// held ids, their appraisal skill.
export async function chipContextFor(character, { gm = false } = {}) {
  const held = character?.tags ?? [];
  return {
    viewer: await chipViewerFor(character),
    heldIds: new Set(held.map((ct) => ct.tagId)),
    canAppraise: held.some((ct) => ct.tag?.slug === APPRAISAL_SLUG),
    gm,
  };
}

// The Tag half. Same pipeline, same order as getVisibleTags.
export function composeChipTag(tag, ctx = {}) {
  const { viewer = null, heldIds = new Set(), gm = false, canAppraise = false } = ctx;
  const shaped = stripWeightless(stripEmptyUnlocks(appraise(cookedTasteOnly(tag), canAppraise)));

  if (!isPaper(shaped)) {
    const { paperKind, paperText, sealMark, ...rest } = shaped;
    return { ...rest, sealMark };
  }
  const { paperText, ...rest } = shaped;
  // `holdsIt` is what makes a book on a floor read "you would have to pick it
  // up" and the same book in a pocket read its text (PAPERWORK.md). It falls
  // out of the held set for free, so no caller has to think about it.
  const reader = { ...viewer, holdsIt: heldIds.has(shaped.id) };
  return {
    // `description` stays the flat sentence for lists; `paper` is the shape
    // PaperSheet.js draws inside the tooltip.
    ...rest,
    description: gm ? paperDescriptionGm(shaped) : paperDescription(shaped, reader),
    paper: gm ? paperViewGm(shaped) : paperView(shaped, reader),
  };
}

// A CharacterTag / RoomTag / stash row as the rails draw it: the per-row
// numbers the tag itself cannot carry, plus the composed tag.
export function toChipRow(row, ctx = {}) {
  const tag = composeChipTag(row.tag, ctx);
  return {
    tagId: row.tagId ?? tag.id,
    quantity: row.quantity ?? 1,
    tag,
  };
}
