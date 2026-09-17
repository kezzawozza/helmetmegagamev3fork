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

// The three datasets behind the {tag:…} / {resource:…} / {document:…} inline reference syntax.
// The root layout calls these un-awaited and streams the promises into client providers.

// Re-exported from tagChipRows.js since a dozen callers already import them from here.
export {
  DESIRE_UNLOCK_SELECT,
  TAG_CHIP_FIELDS,
  APPRAISAL_SELECT,
  // The pair a TagChip surface wants. TAG_CHIP_FIELDS above is the narrow half
  // and draws a paper tag blank — see tagChipRows.js's header.
  chipSelect,
  composeChipTag,
  toChipRow,
  chipContextFor,
  GM_CHIP_CTX,
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

  const ctx = await chipContextFor(character);
  const held = ctx.heldIds;

  // Runtime-minted rows (paper, sealed letters, crates, headstones) are unbounded game state, so a
  // caller sees only the ones they hold. Sequential, since the held ids are the filter.
  const tags = await prisma.tag.findMany({
    where: { OR: [{ ephemeral: false }, { id: { in: [...held] } }] },
    select: CHIP_ROW_SELECT,
  });

  // A recipe line must not print an ingredient this viewer has no path to (web/lib/recipeCatalog.js).
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



// Must be computed per-request — productionCoefficient is a live dial on /gm/dev.
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

// Pre-formatted per tag from the live caps so the client never imports @lifeweb/db.
export async function getCarryReference() {
  const [config, tags] = await Promise.all([
    // One cap now. The ⬢ cap was deleted with the columns behind it — ⬢ weigh
    // a pound each and push against the pound cap beside the gear (CARRY.md).
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { carryWeightLbs: true } }),
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

// `name` ships for every written document, `source`/`excerpt` only when the reader may read it.
// Session-dependent — must never be cached across callers.
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
