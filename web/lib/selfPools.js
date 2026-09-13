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
import { isUnaffiliated } from "@lifeweb/db/lib/factionConstants";
import { placeKeyForRoom } from "@lifeweb/db/lib/placeKey";
import { describeTurn } from "@/lib/turnFormat";
import { loadFaction } from "@/lib/factionView";
import { getMyFactionRole } from "@/lib/factionPermissions";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";

// Everything a surface needs to draw a character's OWN state, the way
// web/lib/peoplePools.js does for the people standing near them. It lived
// inside web/app/(app)/character/page.js while the sheet was the only place
// that drew it; Chat's YOU column is the second.
//
// Every gate is evaluated HERE, server-side. The client never runs the gate
// logic and never receives a hidden template.
//
// `character` needs { id, tags: [{ tagId, tag }], role: { slug } }.
//
// `withCatalog: false` is Chat's ask: the picker is closed on almost
// every page load, and the evaluated catalog is ~271 templates. The slot half
// — which slots are open, what was last claimed in each — costs one query, so
// that is what the first paint carries. Chat fetches the other half
// through a server action the first time somebody opens the picker.
export async function loadDesireView(character, { openTurn, gameConfig, withCatalog = true } = {}) {
  const desireSlots = gameConfig?.desireSlots ?? 2;
  const desireSlotLockTurns = gameConfig?.desireSlotLockTurns ?? 1;
  // Manic. The client needs no flag of its own: slotStates below already comes
  // back unlocked for a holder, and the sheet labels a slot off that.
  const slotsNeverLock = desireSlotsNeverLock(character.tags ?? []);
  const heldTags = (character.tags ?? []).map((ct) => ct.tag);
  const heldDesireTagIds = new Set((character.tags ?? []).map((ct) => ct.tagId));
  const openTurnNumber = openTurn?.number ?? 0;

  // ALL statuses — the gate evaluator needs the whole history.
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
  });

  // The `hidden` half (db/lib/desireGates.js) never reaches this variable.
  // A "locked" entry (unmet requires, or a family a held tag shuts) is
  // dropped here too. Cooldown/once-ever-done rows stay, since those are
  // claimed already, just not claimable right now.
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
//
// Everything the paperwork dialogs need (docs/systemdocs/PAPERWORK.md, §Bird),
// as the exact props RequestActionsProvider takes. It was written inline in
// web/app/(app)/character/page.js while the sheet was the only surface that
// opened those dialogs; Chat's composer is the second, and a second copy
// of these gates would be a second answer to "can this character write".
//
// `character` needs { id, locationId, tags: [{ tagId, quantity, tag }],
// location: { indoors }, birdTurnId, birdDaySends }.
//
// The TEXT of a paper never comes back from here — only an excerpt, and only
// for a reader. The dialogs fetch the whole thing on demand
// (character/paperActions.js#readMyPaper), so an unreadable sheet is never
// sitting in a client payload waiting to be read out of the page source.
export async function loadLettersView(character, { openTurn = null } = {}) {
  const tags = character.tags ?? [];
  const hasBird = holdsBirdAndLetters(tags);
  // Letters AND eyes — the same predicate the tag chips, the noticeboard and
  // paperActions.js all use, so the button, the chip and the server's refusal
  // can never disagree.
  const canReadNow = canRead(tags, {
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  });
  // Something to write ON: a blank sheet, a blank book, or a note already
  // started. A sealed letter does not count — you would have to break the seal
  // first, and a written book is finished for good.
  const writables = tags.filter(
    (ct) =>
      ct.tag.slug === PAPER_SLUG ||
      ct.tag.slug === BLANK_BOOK_SLUG ||
      ct.tag.paperKind === "PAPER",
  );
  const canWrite = canReadNow && writables.length > 0;
  // Wax stamps in hand, and letters worth closing.
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
    // A blank book wants a title as well as a body, and takes six times the
    // text. The dialog reads this off the chosen option.
    book: ct.tag.slug === BLANK_BOOK_SLUG,
    quantity: ct.quantity,
    // Enough to tell two notes apart in a dropdown, and only for a reader.
    excerpt:
      canReadNow && ct.tag.paperKind === "PAPER"
        ? (ct.tag.paperText ?? "").trim().slice(0, 60)
        : null,
  }));
  // Everything a bird could carry. Sealed letters included — a courier does
  // not have to be able to read what they are carrying, which is rather the
  // use of an illiterate one.
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
      // A sheet that arrived untitled may be labelled at the wax, and one that
      // already has a title may not — the writer named it and a second hand
      // does not get to rename it. The dialog hides its title field off this;
      // paperMint.js#sealWithMark is the lock behind it.
      titled: Boolean((ct.tag.paperTitle ?? "").trim()),
    })),
  };

  // Compared against the in-game DAY (birdTurnId stores the day), not the
  // turn. Advisory only — the server's conditional claim is the real gate.
  //
  // It is a COUNT against an allowance now, not a boolean: a Rookery standing
  // where they are is worth several flights a day (db/lib/rookery.js). Read
  // the allowance only for somebody actually holding a bird — 56 of the 57
  // Locations have no rookery and should not pay for a query to find that out.
  const birdAllowance = hasBird
    ? birdAllowanceFrom(
        await structuresAt(prisma, character.locationId, { statuses: WORKING_STATUSES }),
      )
    : BASE_BIRD_SENDS_PER_DAY;
  const sameDay =
    Boolean(openTurn) && character.birdTurnId === String(describeTurn(openTurn).day);
  const birdSentToday = sameDay && (character.birdDaySends ?? 0) >= birdAllowance;

  // The Raven Draught (REQUESTS.md) reaches anybody, anywhere, once. It shares
  // the Bird's recipient list below rather than building a second one — both
  // are "every character in the game", and two queries would be two chances
  // for one of them to start filtering by liveness and become a casualty list.
  const hasRavenDraught = tags.some(
    (ct) => ct.tag.slug === "raven-draught" && ct.quantity > 0,
  );

  // Recipient list is EVERY character regardless of status; a letter to a dead
  // name never arrives. Only fetched for someone holding a bird or a draught.
  const birdTargets = hasBird || hasRavenDraught
    ? await prisma.character.findMany({
        where: { id: { not: character.id } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  // Everywhere standable except the two deep cave levels (birdZones()).
  const birdZones = hasBird
    ? birdZonesOf(
        await prisma.zone.findMany({
          select: { id: true, name: true, slug: true, kind: true },
          orderBy: { sortOrder: "asc" },
        }),
      ).map((z) => ({ id: z.id, name: z.name }))
    : [];

  // Letters the bird is still standing over, waiting for something to carry
  // back (docs/systemdocs/BIRD.md). Not gated on `hasBird`: the bird that
  // brought it is the one that takes the answer, so replying needs no bird of
  // your own — only the letters in your hands and the ability to work it.
  //
  // The window is the turn it arrived in and the one after. The authority is
  // db/lib/birdReply.js#birdReplyWindow, which the answer re-runs; this is the
  // read-side half, so a shut window greys the button rather than opening a
  // dialog that can only refuse.
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
          // A GM letter is signed with whatever name the GM wrote it under,
          // which is already the snapshot in senderName (BIRD.md §9).
          senderName: m.senderName,
        }))
      : [];

  return {
    hasBird,
    hasRavenDraught,
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

// ---- The faction, for Chat's Faction panel ------------------------------
//
// The same loaders /faction runs — web/lib/factionView.js#loadFaction and the
// Leader/Treasurer test in db/lib/factionPermissions.js — so the two surfaces
// can never disagree about who is in a faction or who may see a member's ⬢
// (FACTIONS.md §5-6).
//
// `resources` is on a roster row ONLY for a Leader or a Treasurer of that same
// faction. It is left off the object entirely rather than nulled, because this
// crosses into a client component and an absent key cannot be read out of the
// page source.
//
// Returns null for a character with no faction, and for the Unaffiliated
// placeholder — which is not a faction (FACTIONS.md §1a) and has no roster
// worth a section in the column.
export async function loadFactionView(session, character) {
  if (!session?.discordUserId || !character?.id) return null;

  let factionId = character.factionId;
  if (factionId === undefined) {
    const row = await prisma.character.findUnique({
      where: { id: character.id },
      select: { factionId: true },
    });
    factionId = row?.factionId ?? null;
  }
  if (!factionId) return null;

  const faction = await loadFaction(factionId);
  if (!faction || isUnaffiliated(faction)) return null;

  // Only the officer bit is read now. There used to be a line under the name
  // saying which seat the VIEWER holds, and it is gone: the roster below
  // already marks the Leader and the Treasurer, so it told an officer
  // something they could read two rows down and everyone else nothing at all.
  const { isOfficer } = await getMyFactionRole(session.discordUserId, faction.id);

  return {
    id: faction.id,
    name: faction.name,
    isOfficer,
    roster: faction.characters.map((c) => ({
      characterId: c.id,
      name: c.name,
      roleTitle: c.roleTitle,
      isLeader: c.isLeader,
      isTreasurer: c.isTreasurer,
      catatonic: c.tags.length > 0,
      avatarVersion: c.updatedAt?.getTime?.() ?? null,
      ...(isOfficer ? { resources: c.resources } : {}),
    })),
    // The silo is a Room, so it already has a place key — the panel's Silo
    // button just selects it, and only when the viewer's own places carry it
    // (a shut door means the room is not in their list at all).
    silo: faction.siloRoom
      ? {
          roomId: faction.siloRoom.id,
          name: faction.siloRoom.name,
          placeKey: placeKeyForRoom(faction.siloRoom.id),
        }
      : null,
  };
}
