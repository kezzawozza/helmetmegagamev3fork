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

// ONE PLACE THAT TURNS A TAG ROW INTO A CHIP, off TAG_CHIP_FIELDS plus a
// composed `paper`. THE RULE THIS MODULE EXISTS TO HOLD: `Tag.paperText`
// NEVER reaches a browser — composeChipTag destructures it off in BOTH
// branches, unconditionally, structural rather than a strip somebody must remember.
//
// ANYTHING THAT RENDERS A TagChip WANTS `chipSelect()` PLUS `composeChipTag()`.
// TAG_CHIP_FIELDS alone is the INCOMPLETE half: a paper row's words live in
// `paperText` and its `description` column is NULL at mint, so a caller that
// took the columns and skipped the compose drew a chip with nothing to say.
// That was the /gm/turns bug — five surfaces had drifted onto the raw columns
// and every paper hovered blank.
//
// TAG_CHIP_FIELDS stays exported for the one caller that must NOT have the
// paper columns: web/lib/pointBuyCatalog.js spreads its whole row into the
// store's DTO, so widening its select is how `paperText` would actually reach
// a browser. Narrow is the safe default; that is why the split stays.

// A tag whose group carries a requiredTag sits in a hidden category
// (TAGS.md §3); gating is on the GROUP only. Which Desires this tag OPENS,
// read from the two UNLOCK relations (`desireForbiddenBy` never renders —
// web/lib/desireUnlocks.js says why); spread this, don't retype it.
export const DESIRE_UNLOCK_SELECT = {
  desireRequiredBy: {
    where: { retired: false },
    select: {
      slug: true,
      name: true,
      tier: true,
      // desireUnlocks.js#rolesNote tells "tag AND role" from "tag OR role".
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
      requiresAllTags: { select: { slug: true, name: true } },
    },
    orderBy: [{ tier: "desc" }, { name: "asc" }],
  },
};

// ~940 of ~1000 tags unlock no Desire; desireUnlocksFor() reads a missing key the same as [].
export function stripEmptyUnlocks(tag) {
  if (tag.desireRequiredBy?.length || tag.desireAllRequiredBy?.length) return tag;
  const { desireRequiredBy, desireAllRequiredBy, ...rest } = tag;
  return rest;
}

export function stripWeightless(tag) {
  if (tag.tradeable && tag.category !== "Assets" && (tag.weightLbs ?? 0) > 0) return tag;
  const { weightLbs, tradeable, ...rest } = tag;
  return rest;
}

// A cook is told an ingredient's TASTE and nothing else, not mood or effect
// (COOKING.md); the whole `cooked` Json block is cut down here on the server
// before it crosses, and `cookedFrom` dropped outright. Deliberate, and it
// also keeps `cooked.hunger` server-only — hunger must never leak to the
// client (see Soilery hunger-meter rework).
export function cookedTasteOnly(tag) {
  if (!tag?.cooked && !tag?.cookedFrom?.length) return tag;
  const { cooked, cookedFrom, ...rest } = tag;
  return cooked ? { ...rest, cooked: { taste: cooked.taste ?? "" } } : rest;
}

export const TAG_CHIP_FIELDS = {
  id: true,
  slug: true,
  name: true,
  mastery: true,
  cooked: true,
  description: true,
  pointCost: true,
  category: true,
  // A caller gating to what the viewer holds must filter group-gated tags
  // itself — the name would tip off anyone else.
  requiredTagId: true,
  requiredTag: { select: { name: true } },
  group: {
    select: {
      slug: true, // the group icon (web/lib/tagIcons.js); the chip's colour comes from `category` above
      name: true,
      requiredTagId: true,
      requiredTag: { select: { name: true } },
    },
  },
  removable: true,
  craftable: true,
  customizable: true,
  healable: true,
  teachable: true,
  requirementTurns: true,
  requirementPerTurn: true,
  requirementResources: true,
  requirementGambit: true,
  requirementSkills: { select: { id: true, slug: true, name: true } },
  // Recipe ingredients (CORPSES.md §8), redacted per viewer in getVisibleTags().
  requirementItems: true,
  catalogVisibility: true,
  defaultDurationTurns: true,
  expiresInto: true,
  inspectVisibility: true,
  // Armour/Worn/Weight/Conceals below are each read in pairs or triples; a
  // partial read renders a wrong or contradictory line.
  meleeArmor: true,
  ballisticArmor: true,
  ...FIGHTING_TAG_FIELDS,
  equipLayer: true,
  twoHanded: true,
  weightLbs: true,
  tradeable: true,
  concealsIdentity: true,
  forcesConceal: true,
  // WHICH KIND of paper this is ("BOOK", "SEALED", ...) and the wax on it,
  // never its words — those stay in paperText, the one genuinely private
  // column. Both of these are already public: the kind is legible from the
  // row's own name, and the whole point of a seal is that callers can see it
  // (PAPERWORK.md). Up here rather than down in PAPER_FIELDS so an uncomposed
  // row is SELF-DESCRIBING — TagDetails.js reads `paperKind && !paper` as
  // "somebody skipped composeChipTag" and says so, instead of the silent blank
  // tooltip that hid this for months.
  paperKind: true,
  sealMark: true,
  // Runtime-minted (paper, corpses, crates, headstones) rather than catalog.
  // Drives the Minted tab in TagCatalogBrowser.js, which is what keeps a
  // thousand player notes out of the Items tab.
  ephemeral: true,
  ...DESIRE_UNLOCK_SELECT,
};

// NOT folded into TAG_CHIP_FIELDS: GM surfaces spread that select without
// calling appraise(), which would leak the raw ⬢/obol number regardless of skill.
export const APPRAISAL_SELECT = { sellablePrice: true };

// THE ONE PRIVATE COLUMN. A paper's text never travels in `description` — it is
// resolved against this viewer by composeChipTag and dropped before anything
// crosses. Not exported: selecting it without composing is the whole hazard.
const PAPER_FIELDS = { paperText: true };

// The columns a chip needs, all of them. `extra` is for the handful of callers
// that want a column the chip itself doesn't read (`stackable`, `equippable`) —
// spread it here rather than rebuilding the select around it.
export function chipSelect(extra = {}) {
  return { ...TAG_CHIP_FIELDS, ...PAPER_FIELDS, ...APPRAISAL_SELECT, ...extra };
}

export const CHIP_ROW_SELECT = chipSelect();

// The reading gate asks about eyes (db/lib/reading.js) and the clock.
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

// `null` yields a viewer holding nothing, read as unable to read.
async function chipViewerFor(character) {
  return {
    tags: character?.tags ?? [],
    phase: await openTurnPhase(),
    indoors: character?.location?.indoors ?? true,
  };
}

// The context every GM surface passes. A GM has no reading gate at all
// (paperViewGm), so there is no viewer to build and nothing to await — which is
// why this is a plain constant rather than a chipContextFor() call. Frozen so a
// caller can't quietly bend one desk's rules. NEVER pass this on a
// player-facing surface: it is what hands somebody a sealed letter's contents.
export const GM_CHIP_CTX = Object.freeze({ gm: true });

export async function chipContextFor(character, { gm = false } = {}) {
  const held = character?.tags ?? [];
  return {
    viewer: await chipViewerFor(character),
    heldIds: new Set(held.map((ct) => ct.tagId)),
    canAppraise: held.some((ct) => ct.tag?.slug === APPRAISAL_SLUG),
    gm,
  };
}

export function composeChipTag(tag, ctx = {}) {
  const { viewer = null, heldIds = new Set(), gm = false, canAppraise = false } = ctx;
  const shaped = stripWeightless(stripEmptyUnlocks(appraise(cookedTasteOnly(tag), canAppraise)));

  if (!isPaper(shaped)) {
    const { paperKind, paperText, sealMark, ...rest } = shaped;
    return { ...rest, sealMark };
  }
  const { paperText, ...rest } = shaped;
  // `holdsIt` makes a floor book read "pick it up first" (PAPERWORK.md).
  const reader = { ...viewer, holdsIt: heldIds.has(shaped.id) };
  return {
    ...rest,
    description: gm ? paperDescriptionGm(shaped) : paperDescription(shaped, reader),
    paper: gm ? paperViewGm(shaped) : paperView(shaped, reader),
  };
}

export function toChipRow(row, ctx = {}) {
  const tag = composeChipTag(row.tag, ctx);
  return {
    tagId: row.tagId ?? tag.id,
    quantity: row.quantity ?? 1,
    tag,
  };
}
