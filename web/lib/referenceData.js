import { prisma, PRODUCTION_RATES, computeRate, formatRate } from "@lifeweb/db";
import { carryCaps, carryBonusLine, MULT_SCALE } from "@lifeweb/db/lib/carry";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { documentSource, isWritten, readerFromCharacter } from "@/lib/documentAccess";
import { toDocumentPreviewText } from "@/lib/documentPreview";
import { redactWithheldRecipes } from "@/lib/recipeCatalog";
import {
  CHIP_ROW_SELECT,
  CHIP_VIEWER_SELECT,
  chipContextFor,
  composeChipTag,
} from "@/lib/tagChipRows";

// The three datasets behind the {tag:…} / {resource:…} / {document:…}
// inline reference syntax. The root layout calls these
// un-awaited and streams the promises into client providers, so the data
// rides the initial response instead of a post-hydration round trip.


// The tag-chip primitives live in tagChipRows.js — the shape and the composer
// that fills it belong together. Re-exported here because a dozen callers have
// always imported them from this module and the path is not the point.
export {
  DESIRE_UNLOCK_SELECT,
  TAG_CHIP_FIELDS,
  APPRAISAL_SELECT,
  PAPER_FIELDS,
  stripEmptyUnlocks,
  stripWeightless,
  cookedTasteOnly,
} from "@/lib/tagChipRows";

// Session-dependent, so it must never be cached across callers.
export async function getVisibleTags() {
  const session = await auth();
  const character = session?.discordUserId
    ? await prisma.character.findFirst({
        where: { discordUserId: session.discordUserId, status: "ALIVE" },
        select: CHIP_VIEWER_SELECT,
      })
    : null;

  // A signed-out caller, or one with no living character, holds nothing.
  const ctx = await chipContextFor(character);
  const held = ctx.heldIds;

  // Runtime-minted rows — written paper, sealed letters, crates, headstones —
  // are game state, not catalog, and there is no ceiling on how many of them
  // the game accumulates. Shipping every one to every browser on every page
  // would grow this payload for the rest of the game, so a caller sees only
  // the ones they are actually holding. (This was already true of crates; it
  // just had no consequences until paper made the set unbounded.)
  //
  // Sequential rather than parallel with the character read, because the held
  // ids are the filter.
  const tags = await prisma.tag.findMany({
    where: { OR: [{ ephemeral: false }, { id: { in: [...held] } }] },
    select: CHIP_ROW_SELECT,
  });

  // A recipe line must not print an ingredient this viewer has no path to —
  // the same rule the /documents catalogs apply (web/lib/recipeCatalog.js).
  // "Visible" here is public-or-held: this payload ships GM-catalog rows to
  // everyone and hides them at render time, so the list itself cannot stand
  // in for what the viewer may READ. Dreamer's Draught keeps its recipe line
  // for the brewer holding a Skinless Brain and goes quiet for everyone else.
  const readableSlugs = new Set(
    tags
      .filter((t) => t.catalogVisibility === "ALL" || held.has(t.id))
      .map((t) => t.slug),
  );
  return redactWithheldRecipes(
    tags
      .filter((tag) => !tag.group?.requiredTagId || held.has(tag.group.requiredTagId))
      .map((tag) => composeChipTag(tag, ctx)),
    { visibleSlugs: readableSlugs },
  );
}



// Computed live from productionCoefficient so docs/documents.yaml's printed
// numbers never drift from actual payout. Each tier ships a pre-formatted
// `display` string so no client component has to import @lifeweb/db, which
// would drag PrismaClient into a "use client" bundle. Must be computed
// per-request — productionCoefficient is a live dial on /gm/dev.
export async function getProductionRates() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const coefficient = config?.productionCoefficient ?? 1;

  const rates = Object.fromEntries(
    Object.keys(PRODUCTION_RATES).map((field) => [
      field,
      Object.fromEntries(
        Object.keys(PRODUCTION_RATES[field]).map((tier) => {
          const rate = computeRate(field, tier, coefficient);
          return [tier, { ...rate, display: formatRate(rate) }];
        }),
      ),
    ]),
  );

  return { coefficient, rates };
}

// The {carry:slug} token (RichText.js): the sentence a carry tag's
// description ends with, pre-formatted per tag from the live caps so the
// client never imports @lifeweb/db. Keyed by slug so a description only
// names itself and the multiplier stays single-sourced in docs/tags.yaml.
export async function getCarryReference() {
  const [config, tags] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { carryWeightLbs: true, carryResourceCap: true } }),
    prisma.tag.findMany({
      where: { carryBonus: { not: null } },
      select: { slug: true, carryBonus: true },
    }),
  ]);
  const lines = Object.fromEntries(tags.map((t) => [t.slug, carryBonusLine(config, t.carryBonus)]));
  return { base: carryCaps(config, MULT_SCALE), lines };
}

const EXCERPT_CHARS = 160;

function excerptOf(description) {
  const flat = toDocumentPreviewText(description).replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", EXCERPT_CHARS))}…`;
}

// The document index for {document:key} chips. Does not ship every
// document to every reader: `name` ships for every written document (so a
// locked chip can say which one), `source`/`excerpt` only when the reader
// may read it. Visibility rules live in web/lib/documentAccess.js, shared
// with /documents. Session-dependent — must never be cached across callers.
export async function getDocumentIndex() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return [];

  const [documents, characterRow] = await Promise.all([
    prisma.document.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      include: {
        role: true,
        faction: true,
        tags: { include: { tag: { select: { slug: true, name: true } } } },
      },
    }),
  ]);

  const character = readerFromCharacter(characterRow);
  // The host, not every GM — see the same gate in (app)/documents/page.js
  // for why this stopped being "holds no zone seat".
  const isMasterGm = isGm && isSuperadmin(session.discordUserId);

  return documents.filter(isWritten).map((d) => {
    const source = documentSource(d, { character, isGm, isMasterGm });
    return {
      key: d.key,
      name: d.name,
      accessible: source !== null,
      source,
      excerpt: source ? excerptOf(d.description) : null,
    };
  });
}
