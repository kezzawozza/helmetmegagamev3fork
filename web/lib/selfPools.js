import "server-only";
import { prisma } from "@lifeweb/db";
import {
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  bottomSlotAddiction,
  unlockedBy,
  desireSlotsNeverLock,
} from "@lifeweb/db/lib/desireGates";
import { desireFamilies, desireFamilyGroups } from "@lifeweb/db/lib/desireFamilies";
import { canRead } from "@lifeweb/db/lib/reading";
import {
  PAPER_SLUG,
  BLANK_BOOK_SLUG,
  isSeal,
  sealLabel,
} from "@lifeweb/db/lib/paper";
import {
  canSendBird as holdsBirdAndLetters,
  birdZones as birdZonesOf,
} from "@lifeweb/db/lib/bird";
import {
  BASE_BIRD_SENDS_PER_DAY,
  birdAllowanceFrom,
} from "@lifeweb/db/lib/rookery";
import { structuresAt, WORKING_STATUSES } from "@lifeweb/db/lib/structures";
import { describeTurn } from "@/lib/turnFormat";
import { isDaylight } from "@lifeweb/db/lib/turnClock";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";

// Everything a surface needs to draw a character's OWN state (as web/lib/peoplePools.js does for
// people nearby). Every gate is evaluated HERE, server-side. `withCatalog: false` is Chat's ask: the
// picker is closed on most loads, so the first paint carries only the slot half.
export async function loadDesireView(character, { openTurn, gameConfig, withCatalog = true } = {}) {
  const desireSlots = gameConfig?.desireSlots ?? 2;
  const desireSlotLockTurns = gameConfig?.desireSlotLockTurns ?? 2;
  // Manic: slotStates below already comes back unlocked for a holder; the sheet labels a slot off that.
  const slotsNeverLock = desireSlotsNeverLock(character.tags ?? []);
  const heldTags = (character.tags ?? []).map((ct) => ct.tag);
  const heldDesireTagIds = new Set((character.tags ?? []).map((ct) => ct.tagId));
  const openTurnNumber = openTurn?.number ?? 0;

  // ALL statuses: the gate evaluator needs the whole history.
  const history = await prisma.desire.findMany({
    where: { characterId: character.id },
    select: {
      id: true,
      templateId: true,
      slotIndex: true,
      status: true,
      text: true,
      points: true,
      setTurnNumber: true,
      endedTurnNumber: true,
      template: { select: { tier: true, cooldownTurns: true, onceEver: true } },
    },
  });

  const view = {
    desireSlots,
    desireSlotLockTurns,
    slotStates: slotStates({
      history,
      openTurnNumber,
      desireSlots,
      lockTurns: desireSlotLockTurns,
      noLock: slotsNeverLock,
    }),
    lockNotes: describeDesireLocks(heldTags, new Map(desireFamilies().map((f) => [f.key, f.name]))),
    addiction: bottomSlotAddiction(heldTags),
    families: desireFamilies(),
    familyGroups: desireFamilyGroups(),
    catalog: [],
  };
  if (!withCatalog) return view;

  const templateRows = await prisma.desireTemplate.findMany({
    where: { retired: false },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      tier: true,
      families: true,
      onceEver: true,
      cooldownTurns: true,
      retired: true,
      requiresAnyOf: true,
      requiresAnyRoleSlugs: true,
      requiresNotRoleSlugs: true,
      requiresAnyTags: { select: { id: true, name: true } },
      requiresAllTags: { select: { id: true, name: true } },
      requiresNotTags: { select: { id: true, name: true } },
    },
  });

  const hiddenTagIds = await computeHiddenDesireTagIds(prisma, heldDesireTagIds);
  const roleBySlug = await loadRoleBySlugForTemplates(prisma, templateRows);
  const projected = templateRows.map((t) => projectDesireTemplateForGates(roleBySlug, t));
  const { visible } = evaluateDesireCatalog({
    templates: projected,
    heldTags,
    hiddenTagIds,
    roleSlug: character.role?.slug ?? null,
    history,
    openTurnNumber,
    desireSlots,
    characterId: character.id,
  });

  // The `hidden` half never reaches this variable; a "locked" entry is dropped too, cooldown rows stay.
  view.catalog = visible
    .filter(({ state }) => state !== "locked")
    .map(({ template, state, availableFromTurn, slotLocks }) => ({
      slug: template.slug,
      name: template.name,
      description: template.description,
      tier: template.tier,
      families: template.families,
      state,
      availableFromTurn,
      slotLocks,
      cooldownTurns: template.cooldownTurns ?? template.tier,
      onceEver: Boolean(template.onceEver),
      unlockedBy: unlockedBy(template, {
        heldTagIds: heldDesireTagIds,
        roleSlug: character.role?.slug ?? null,
      }),
    }));
  return view;
}

// ---- Letters, seals, books and the Bird ------------------------------------
// Everything the paperwork dialogs need (PAPERWORK.md, §Bird), shared between the sheet and Chat's
// composer. The TEXT of a paper never comes back from here — only an excerpt for a reader; the dialogs
// fetch the whole thing on demand (character/paperActions.js#readMyPaper).
export async function loadLettersView(character, { openTurn = null } = {}) {
  const tags = character.tags ?? [];
  const hasBird = holdsBirdAndLetters(tags);
  // Letters AND eyes — the same predicate the tag chips, the noticeboard and paperActions.js all use.
  const canReadNow = canRead(tags, {
    daylight: isDaylight(),
    indoors: character.location?.indoors ?? true,
  });
  // Something to write ON: a blank sheet, a blank book, or a note already started; a sealed letter doesn't count.
  const writables = tags.filter(
    (ct) =>
      ct.tag.slug === PAPER_SLUG ||
      ct.tag.slug === BLANK_BOOK_SLUG ||
      ct.tag.paperKind === "PAPER",
  );
  const canWrite = canReadNow && writables.length > 0;
  const seals = tags.filter((ct) => isSeal(ct.tag));
  const hasSeal = seals.length > 0;
  const sealables = tags.filter(
    (ct) => ct.tag.paperKind === "PAPER" && (ct.tag.paperText ?? "").trim(),
  );
  const canSeal = hasSeal && sealables.length > 0;

  const paperOptions = writables.map((ct) => ({
    tagId: ct.tagId,
    name: ct.tag.name,
    blank: ct.tag.slug === PAPER_SLUG,
    // A blank book wants a title as well as a body, and takes six times the text.
    book: ct.tag.slug === BLANK_BOOK_SLUG,
    quantity: ct.quantity,
    excerpt:
      canReadNow && ct.tag.paperKind === "PAPER"
        ? (ct.tag.paperText ?? "").trim().slice(0, 60)
        : null,
  }));
  // Everything a bird could carry, sealed letters included — a courier need not read what it carries.
  const letterOptions = tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      excerpt:
        canReadNow && ct.tag.paperKind === "PAPER"
          ? (ct.tag.paperText ?? "").trim().slice(0, 60)
          : null,
    }));
  const sealOptions = {
    stamps: seals.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      label: sealLabel(ct.tag),
    })),
    letters: sealables.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      excerpt: canReadNow ? (ct.tag.paperText ?? "").trim().slice(0, 60) : null,
      // An untitled sheet may be labelled at the wax; a titled one may not — the writer named it.
      titled: Boolean((ct.tag.paperTitle ?? "").trim()),
    })),
  };

  // Compared against the in-game DAY, advisory only. A COUNT against an allowance, not a boolean
  // (db/lib/rookery.js), read only for somebody holding a bird.
  const birdAllowance = hasBird
    ? birdAllowanceFrom(
        await structuresAt(prisma, character.locationId, { statuses: WORKING_STATUSES }),
      )
    : BASE_BIRD_SENDS_PER_DAY;
  const sameDay =
    Boolean(openTurn) && character.birdTurnId === String(describeTurn(openTurn).day);
  const birdSentToday = sameDay && (character.birdDaySends ?? 0) >= birdAllowance;

  // Recipient list is EVERY character regardless of status; a letter to a dead name never arrives.
  const birdTargets = hasBird
    ? await prisma.character.findMany({
        where: { id: { not: character.id } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  const birdZones = hasBird
    ? birdZonesOf(
        await prisma.zone.findMany({
          select: { id: true, name: true, slug: true, kind: true },
          orderBy: { sortOrder: "asc" },
        }),
      ).map((z) => ({ id: z.id, name: z.name }))
    : [];

  // Letters the bird is still standing over (BIRD.md); not gated on `hasBird`, only the letters in hand.
  // The window mirrors db/lib/birdReply.js#birdReplyWindow, so a shut window greys the button instead of opening a dialog that refuses.
  const birdReplies =
    canReadNow && letterOptions.length > 0
      ? (
          await prisma.birdMessage.findMany({
            where: {
              recipientId: character.id,
              delivered: true,
              repliedAt: null,
              ...(openTurn
                ? { replyDeadlineTurn: { gte: openTurn.number } }
                : { replyDeadlineTurn: { not: null } }),
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, senderName: true, gmSenderDiscordUserId: true },
          })
        ).map((m) => ({
          id: m.id,
          // A GM letter is signed with whatever name the GM wrote it under (BIRD.md §9).
          senderName: m.senderName,
        }))
      : [];

  return {
    hasBird,
    birdReplies,
    canRead: canReadNow,
    canWrite,
    hasSeal,
    canSeal,
    paperOptions,
    letterOptions,
    sealOptions,
    birdSentToday,
    birdTargets,
    birdZones,
  };
}

