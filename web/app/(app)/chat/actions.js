"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { affordancesFor, locationAffordances, roomAffordances } from "@lifeweb/db/lib/placeAffordances";
import { parksMounts, hasAttribute, SAFE_ATTRIBUTE } from "@lifeweb/db/lib/locationAttributes";
import { toggleGate, holdKeyedOpen, GATE_CHARACTER_SELECT } from "@lifeweb/db/lib/gates";
import { fileMove } from "@lifeweb/db/lib/moves";
import { confirmMove } from "@lifeweb/db/lib/moveConfirm";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { resolveLaborRate, REFINERY_NOTE } from "@lifeweb/db/lib/laborAccess";
import { qualityWord } from "@lifeweb/db/lib/laborYield";
import { clockFrozen } from "@lifeweb/db/lib/gameState";
import { loadDesireView } from "@/lib/selfPools";
import { withoutDmNoise, PLAYER_DM_SELECT, playerDmRow } from "@/lib/dmThread";
import { resolveDmActions } from "@/lib/dmActions";
import { PLAYER_DM_MAX_LENGTH } from "@/lib/constants";
import { whosHere, whosHereGm, resolveHoodToken } from "@lifeweb/db/lib/whosHere";
import { lastSightings } from "@lifeweb/db/lib/sightings";
import { VIEWER_SELECT, examineRow } from "@lifeweb/db/lib/examineRow";
import { travelOptions, linksFor, endpoints, isHeldOpen } from "@lifeweb/db/lib/locationGraph";
import { examineLines } from "@lifeweb/db/lib/examineLocation";
import { structuresAt } from "@lifeweb/db/lib/structures";
import { visibleZoneIds } from "@lifeweb/db/lib/gmZoneView";
import { roomLine, locationLine, zoneLine } from "@lifeweb/db/lib/placeLine";
import { heldReasonFor } from "@lifeweb/db/lib/intercept";
import { blocksOnFoot, equippedSlugs, fastTravelCapacity } from "@lifeweb/db/lib/mounts";
import {
  performLocationMove,
  freeMovesLeft,
  freeZoneMovesReason,
} from "@lifeweb/db/lib/locationTravel";
import {
  ESCORT_SELECT as MOVER_SELECT,
  escortAuthority,
  escortRefusal,
  escortCandidates,
  partyOf,
  attach,
  detach,
  createEscortOffer,
  acceptEscort,
  escortReason,
} from "@lifeweb/db/lib/escort";
import { accessibleRooms, roomAccessKeys, syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { dismountedMessage } from "@lifeweb/db/lib/indoors";
import {
  boardFor,
  boardText,
  destroyNotice,
  pinnedLine,
  tornLine,
  BOARD_OPTION_LIMIT,
} from "@lifeweb/db/lib/noticeboard";
import { paperDescription, paperView, TITLE_MAX, WRITE_MAX } from "@lifeweb/db/lib/paper";
import { mintUnownedPaper } from "@lifeweb/db/lib/paperMint";
import { cleanCustomText } from "@lifeweb/db/lib/customText";
import { getGmSession } from "@/lib/discordGuild";
import { readBlock } from "@lifeweb/db/lib/reading";
import { addToStack, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { expiryFrom } from "@lifeweb/db/lib/turnFormat";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { sceneLineAt } from "@lifeweb/db/lib/scene";
import { postMessage, addThreadMember } from "@lifeweb/db/lib/discordRest";
import {
  addConversationMember,
  removeConversationMember,
  conversationMembers,
  conversationMemberIds,
} from "@lifeweb/db/lib/conversations";
import { toggleConceal as concealRule } from "@lifeweb/db/lib/conceal";
import { shout, deliverShout } from "@lifeweb/db/lib/shout";
import { XOM_SHRINE_ROOM_SLUG, grantXom } from "@lifeweb/db/lib/xom";
import { openConversationThread } from "@lifeweb/db/lib/conversationOpen";
import { castDie } from "@lifeweb/db/lib/roll";
import { addRoomGuest, removeRoomGuest, roomGuests } from "@lifeweb/db/lib/roomGuests";
import { presentedNameOf, resolveMemberToken } from "@lifeweb/db/lib/presentedMembers";
import { notifyPresence } from "@lifeweb/db/lib/presenceNotify";
import { sceneLine } from "@lifeweb/db/lib/scene";
import { playInstrument } from "@lifeweb/db/lib/instrumentPlay";
import { parsePlaceKey, isScenePlaceKey } from "@lifeweb/db/lib/placeKey";
import { removeThreadMember } from "@lifeweb/db/lib/discordRest";
import { BELL_ROOM_SLUG, RING_WORD, bellWordMatches, bellCooldown, broadcastBell } from "@lifeweb/db/lib/bell";
import {
  ARM_WORD,
  DISARM_WORD,
  turretWordMatches,
  gatehouseTurretArmed,
  GATEHOUSE_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
} from "@lifeweb/db/lib/gatehouseTurret";
import { INTERCOM_ROOM_SLUG, broadcastIntercom } from "@lifeweb/db/lib/intercom";
import { loadVoiceState } from "@lifeweb/db/lib/say";
import { recordArchiveMessage } from "@lifeweb/db/lib/archive";
import { acceptLesson, declineOffer } from "@lifeweb/db/lib/lessons";
import { acceptBind } from "@lifeweb/db/lib/bind";
import { acceptConfession } from "@lifeweb/db/lib/confession";
import { settleCarry, deliverCarryDrop } from "@lifeweb/db/lib/carry";
import { acceptThreatSpawn, declineThreatSpawn, applySpawnSideEffects } from "@lifeweb/db/lib/threatSpawn";
import { declineAssignment } from "@lifeweb/db/lib/lobby";
import { mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";
import { photoCaption } from "@lifeweb/db/lib/photo";
import { CAMERA_SLUG, mintPhoto } from "@lifeweb/db/lib/photoMint";
import { sendDm } from "@/lib/discordGuild";
import { DM_KIND } from "@lifeweb/db/lib/dmKinds";
import { thingGroups } from "./thingRows";

// Every button in Chat's right column, as a server action.
//
// THE CONTRACT, and it is the same one for all of them: the acting character
// is resolved from the session, never from anything posted; every gate the
// panel drew is re-checked here, because a disabled button is a hint and not
// a lock; the answer is `{ ok: true, … }` or `{ ok: false, error }`, and
// nothing throws out to the client (web/app/components/useActionRunner.js
// turns a transport failure into a sentence, and a thrown one into the wrong
// sentence).
//
// The GAME logic lives in db/lib, so the Discord button and the web dialog
// run one implementation: db/lib/gates.js, db/lib/moves.js,
// db/lib/whosHere.js, db/lib/examine.js, db/lib/locationTravel.js.
// What is written out below is the sequencing each face needs and nothing
// else.

// The acting character, from the session. `select` widens it for whichever
// action needs more; the default is what almost all of them need.
async function actor(select) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in." };
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: select ?? {
      id: true,
      name: true,
      zoneId: true,
      locationId: true,
      factionId: true,
      discordUserId: true,
      // "Play from the web" — nothing here may touch Discord for them
      // (docs/systemdocs/CHAT.md §6).
      webOnly: true,
      // The tag slugs are what the room `access:` lists read, which is what
      // decides both which rooms this character can enter and — since the
      // winch lives in the watchtower — which gates they may work.
      role: { select: { slug: true } },
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!character) return { error: "You have no living character." };
  return { character, discordUserId: session.discordUserId };
}

// Standing in the room is the whole permission model for everything a Room
// button does — you cannot pull a bell rope from three zones away.
async function roomHere(character, roomId, slug, missing) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || (slug && room.slug !== slug)) return { error: missing };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more.` };
  }
  return { room };
}

// ---------------------------------------------------------------- the place

// The whole place panel, re-read. The page renders the first copy; this is
// what a dialog calls after it changed something a button's label depends on
// (a gate that is now shut, a door now being held).
export async function loadAffordances() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  return { ok: true, affordances: await affordancesFor(prisma, me.character) };
}

// Looking at whoever said one line — the web twin of the 🔍 reaction, and the
// only look the page has now. Both eyes point here: the one on a row in the
// feed, and the one on a row in HERE, which aims at the last line it watched
// that person say.
//
// The browser sends a SEQ and nothing else. Who spoke, whether they were
// hooded and whether this reader may see the place are all resolved on the
// server (db/lib/examineRow.js), which is what lets a hooded line carry an eye
// at all — the page never learns who is under the hood, so there is nothing
// for it to leak. That replaces the hood token this used to resolve, and it
// works on a line scrolled back to long after the speaker walked out, which a
// token keyed on who is standing here never could.
export async function lookAtRow(seq) {
  const me = await actor({ id: true, factionId: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };
  const viewer = await prisma.character.findUnique({ where: { id: me.character.id }, select: VIEWER_SELECT });
  const result = await examineRow(prisma, viewer, seq);
  if (!result) return { ok: false, error: "You can't see them." };
  if (result.blocked) return { ok: false, error: result.blocked };
  return { ok: true, readout: result.readout };
}

// Photographing what somebody said — the web twin of the 📸 reaction
// (bot/src/events/messageReactionAdd.js#handleCameraReaction). The row is the
// only thing the browser sends; who spoke, whether they were hooded, whether
// this reader may see the place and what the room could see of the speaker
// AT THE TIME are all resolved by db/lib/examineRow.js, the same path the eye
// takes. A print is permanent, so a caption written off live state was the
// worst version of the look-at-now bug: evidence that outlives the look.
//
// The camera is NOT spent: holding one is the whole gate, and film is not a
// system anybody asked for. What bounds it instead is one shot per line per
// photographer — otherwise a reader could mint unbounded Tag rows off one
// message, and every one of those is a permanent catalog row. The bot keeps
// that bound in memory, which a restart empties and which the web process
// could never share, so this one is a row in AuditLog. It is the same shot
// either way, so the two faces refusing separately costs a player nothing.
//
// No `turnId`: that column is for the per-turn rations that count these rows
// (REQUESTS.md §1a), and this ration is per LINE rather than per turn.
const PHOTO_ACTION = "photo_taken";

export async function photographRow(seq) {
  const me = await actor({
    id: true,
    factionId: true,
    locationId: true,
    discordUserId: true,
    tags: { select: { quantity: true, tag: { select: { slug: true } } } },
  });
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  const holds = (slug) => character.tags.some((ct) => ct.tag?.slug === slug && (ct.quantity ?? 0) > 0);

  if (!holds(CAMERA_SLUG)) return { ok: false, error: "You have no camera." };

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, error: "That line is gone." };
  }

  // One shot per line per photographer, read off the INDEXED columns.
  // AuditLog has (actorDiscordUserId, actionType, turnId) and (actionType);
  // it has no index over `details`, so a `path: ["seq"]` filter was a scan of
  // the whole table on a button anybody can press. The seq is checked in JS
  // over this photographer's own prints, which is a handful of rows.
  const mine = await prisma.auditLog.findMany({
    where: { actorDiscordUserId: me.discordUserId, actionType: PHOTO_ACTION },
    select: { details: true },
  });
  const wanted = String(key);
  if (mine.some((entry) => String(entry.details?.seq ?? "") === wanted)) {
    return { ok: false, error: "You already have that shot." };
  }

  // Only what the audit row files, plus the one refusal examineRow cannot
  // word for itself: it returns a bare null for your own line, and "point it
  // at somebody else" is worth more than "that line is gone". Everything else
  // about the row — the place, the floor, the kind, the speaker — is its call.
  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    select: { placeKey: true, characterId: true },
  });
  if (!row?.characterId) return { ok: false, error: "That line is gone." };
  if (row.characterId === character.id) return { ok: false, error: "Point it at somebody else." };

  // The shot itself is the ordinary look, through the one path every look in
  // the game takes (db/lib/examineRow.js). This used to be a second copy of
  // that — its own row fetch, its own place gate, its own subject load, its
  // own examineReadout — and the copies had already drifted twice over: it
  // decided a hood by `concealedAlias != null` rather than wasHooded(), so a
  // forced name photographed as an impoverished hood here and as an ordinary
  // read in Discord; and its sight gate was Blind alone where the eye's is the
  // full examineBlock, so a nearsighted player could not look but could
  // photograph. Framing a shot is something you do by eye, and now it is
  // gated exactly as 🔍 and 📸 are.
  //
  // `bystander: true` is what makes it a LENS rather than a person: no
  // doctor's eye, no Seductive, no Thanati sight. Without it a surgeon's
  // photograph would carry their diagnosis to whoever they handed the print
  // to, which is the one way that gate could be laundered.
  const viewer = await prisma.character.findUnique({ where: { id: character.id }, select: VIEWER_SELECT });
  const result = await examineRow(prisma, viewer, key, { bystander: true });
  if (!result) return { ok: false, error: "That line is gone." };
  if (result.blocked) return { ok: false, error: result.blocked };
  const readout = result.readout;
  const hooded = readout.concealed;

  // No transaction: nothing is spent, so there is nothing that has to be
  // atomic with the print — and mintPhoto's collision retry cannot run inside
  // one (db/lib/photoMint.js#createWithRetry).
  const photo = await mintPhoto(prisma, character.id, {
    subject: readout.name,
    caption: photoCaption(readout),
    subjectCharacterId: row.characterId,
  });

  // Written only once the print exists, so a failed mint leaves the shot
  // there to try again rather than burning it.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: me.discordUserId,
      actionType: PHOTO_ACTION,
      targetCharacterId: row.characterId,
      details: { seq: wanted, placeKey: row.placeKey, hooded, photoTagId: photo.id, photoName: photo.name },
    },
  });

  return {
    ok: true,
    readout,
    photoName: photo.name,
    line: `You take a photograph of ${readout.name}.`,
  };
}

// ⭐ from the web. The twin of the reaction in Discord
// (bot/src/events/messageReactionAdd.js#handleStarReaction) and it writes the
// same `Note` row, so a line starred here and a line starred there land on the
// same /notes page in the same shape.
//
// A line with no Discord message behind it — a web-only player's, or one the
// outbox has not pushed yet — still needs a stable key for Note's
// (discordMessageId, discordUserId) unique, so it is filed under its seq
// instead. Using the real message id when there is one is what keeps a ⭐ in
// Discord and a ⭐ here from making two notes out of one message.
export async function starRow(seq) {
  // locationId is what db/lib/feedAccess.js#placesFor reads — without it the
  // place list comes back empty and every star is refused.
  const me = await actor({ id: true, name: true, discordUserId: true, zoneId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, error: "That line is gone." };
  }

  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    select: {
      seq: true,
      kind: true,
      placeKey: true,
      content: true,
      sentAt: true,
      zoneId: true,
      characterId: true,
      characterName: true,
      concealedAlias: true,
      presentedAvatarPath: true,
      discordMessageId: true,
      discordChannelId: true,
      deletedAt: true,
    },
  });
  if (!row || row.deletedAt || !row.content) return { ok: false, error: "That line is gone." };

  // The same gate the feed itself reads by (db/lib/feedAccess.js). A seq is a
  // guessable number, so this is what stops one being starred out of a room
  // the reader is standing outside of.
  const allowed =
    Boolean(row.placeKey) &&
    (await mayReadPlace(prisma, character, row.placeKey, { gm: false, discordUserId: me.discordUserId }));
  if (!allowed) return { ok: false, error: "That line is gone." };

  await prisma.note.upsert({
    where: {
      discordMessageId_discordUserId: {
        discordMessageId: row.discordMessageId ?? `seq:${row.seq}`,
        discordUserId: me.discordUserId,
      },
    },
    create: {
      discordMessageId: row.discordMessageId ?? `seq:${row.seq}`,
      discordChannelId: row.discordChannelId ?? "",
      characterId: row.characterId,
      // Filed under the alias a concealed or forced line was said as, for the
      // reason handleStarReaction gives: the note is private, but writing the
      // real name into it hands the starrer what the hood was hiding.
      characterName: row.concealedAlias ?? row.characterName ?? "Bascinet",
      // And the face beside it, on the same gate — a note drawing the real
      // portrait next to an alias hands back what the alias withheld. Null is
      // their own face, and only a line said under one records it.
      presentedAvatarPath: row.concealedAlias ? (row.presentedAvatarPath ?? null) : null,
      zoneId: row.zoneId ?? null,
      content: row.content,
      sentAt: row.sentAt,
      discordUserId: me.discordUserId,
    },
    update: {},
  });

  return { ok: true, line: "Saved to your Notes." };
}

// What is lying in a room's stash, as STRUCTURE rather than as a sentence.
//
// It used to answer with formatStashLine's Discord line — `-# 0 ⬢ | **Tags**:
// Paper ×23` — which the column then printed raw, subtext marker, asterisks
// and all. That helper stays exactly as it is for the bot, which is talking
// into a channel that renders those markers. The web draws its own chips off
// the rows, so nothing is being formatted twice.
// THE THINGS DRAWER (CHAT.md §7). What is in this character's pockets, in the
// two categories a player carries — read back after every Equip, Use, Give or
// Destroy, and on the column's own minute, so a thing handed over in Discord
// stops being listed here without a reload.
//
// Nothing is decided in the browser: the four verbs come off the catalog flags
// through ./thingRows.js, and each one re-checks itself when it is pressed.
export async function myThings() {
  const me = await actor({
    id: true,
    tags: {
      select: {
        id: true,
        tagId: true,
        quantity: true,
        equipped: true,
        // M4 fix round: thingGroups derives its own poisonMarker off this —
        // never returned raw, see thingGroups' own comment.
        poisonedCount: true,
        equippedQuantity: true,
        tag: {
          select: {
            id: true,
            // canDetectPoison reads slugs (thingRows.js), so the drawer's own
            // re-read has to carry them or a detector's marker survives the
            // first paint and vanishes on the next refresh.
            slug: true,
            name: true,
            description: true,
            category: true,
            equippable: true,
            consumable: true,
            tradeable: true,
            removable: true,
            // The drawer draws each row's weight, and thingRows.js is the one
            // place that shape is built — so leaving this out here would let
            // the re-read after a verb disagree with the first paint, which is
            // the exact thing that module exists to prevent.
            weightLbs: true,
          },
        },
      },
    },
  });
  if (me.error) return { ok: false, error: me.error };
  return { ok: true, groups: thingGroups(me.character.tags) };
}

export async function readStash(roomId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const rooms = await prisma.room.findMany({
    where: { locationId: me.character.locationId ?? "" },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      accessTagSlugs: true,
      resources: true,
      tags: {
        where: { quantity: { gt: 0 } },
        orderBy: { tag: { name: "asc" } },
        // description: what the chip says on hover, so a floor full of names
        // is a floor you can read before you pick anything up.
        select: { tagId: true, quantity: true, tag: { select: { name: true, description: true } } },
      },
    },
  });
  const keys = await roomAccessKeys(prisma, me.character.id);
  // A room you cannot get into is a locked door, not an empty one.
  const room = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds).find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "You can't get in there." };
  return {
    ok: true,
    name: room.name,
    resources: room.resources ?? 0,
    items: (room.tags ?? [])
      .filter((rt) => (rt.quantity ?? 0) > 0)
      .map((rt) => ({
        tagId: rt.tagId,
        name: rt.tag.name,
        description: rt.tag.description ?? "",
        quantity: rt.quantity,
      })),
  };
}

// ---------------------------------------------------------------- travelling

export async function loadTravel() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;
  if (!character.locationId) return { ok: false, error: "You are nowhere yet." };

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const [options, party, currentZone] = await Promise.all([
    travelOptions(prisma, character, character.locationId),
    partyOf(prisma, character.id),
    character.zoneId ? prisma.zone.findUnique({ where: { id: character.zoneId }, select: { slug: true } }) : null,
  ]);

  return {
    ok: true,
    // Somebody has hold of them (INTERCEPT.md). travelOptions has already
    // shut every way and written the reason onto each row; this is the banner
    // over the list, so the panel says it once rather than fifty times.
    held: heldReasonFor(character),
    // The AMBIENT count, before any destination is picked — freeZoneMoves'
    // own honest answer with no crossing to weigh (see its doc comment). Both
    // count the party: over the mount's seats, the extra crossing it buys is
    // gone, and the number here has to already say so (MAP.md §3a).
    freeLeft: freeMovesLeft(character, config, openTurn, party.length),
    freeReason: freeZoneMovesReason(character, party.length),
    // Whether there's anything to dismount at all — the node list only
    // marks a specific way or a specific destination as a consequence when
    // this is true, since neither "on foot" nor "indoors" means anything to
    // somebody already walking.
    mounted: blocksOnFoot(equippedSlugs(character.tags ?? [])),
    options: options.map((row) => ({
      id: row.location.id,
      name: row.location.name,
      // Already loaded: locationGraph's LINK_INCLUDE pulls whole Location rows
      // on both ends of a link, so this costs no query. The node draws it so
      // the way out says what it leads to, not just where.
      description: row.location.description || null,
      zoneName: row.location.zone?.name ?? null,
      zoneSlug: row.location.zone?.slug ?? null,
      // A CAVE_LEVEL destination the Caving Die actually rolls at —
      // travelCost.js#crossingConfirm reads this to warn before a zone
      // crossing lands somebody underground (CAVING.md §2). Excludes Customs
      // and the Depot, the two `safe` Locations the Die skips (CAVING.md
      // §2a) — warning about a die that will not roll would be simply wrong.
      caveLevel:
        row.location.zone?.kind === "CAVE_LEVEL" && !hasAttribute(row.location, SAFE_ATTRIBUTE),
      crossesZone: row.crossesZone,
      passable: row.passable,
      // THIS destination's own count, unlike the ambient one above — a boat's
      // bonus is earned per crossing (db/lib/mounts.js#boatCrossing), so
      // Forest<->Hills or Hills<->Marshes has to show one more than a
      // crossing the water does nothing for, even though both are "a zone
      // crossing" equally as far as `crossesZone` is concerned.
      freeLeft: freeMovesLeft(character, config, openTurn, party.length, {
        fromZoneSlug: currentZone?.slug ?? null,
        toZoneSlug: row.location.zone?.slug ?? null,
      }),
      // A Location a mount gets parked at on arrival (db/lib/indoors.js) —
      // which is not every Location with a roof over it.
      indoors: parksMounts(row.location),
      // A way too narrow to ride or push through — crossing it dismounts
      // instead of refusing (db/lib/indoors.js#dismountForNarrowWay).
      dismounts: Boolean(row.dismounts),
      // Which of this character's own tags opens the way, when one does — the
      // node draws it as that tag's chip, so a climb you paid Mountaineering
      // for says so instead of looking like every other road. Only ever a tag
      // they hold (locationGraph.js#crossingCheck), so there is nothing here to
      // leak.
      openedBy: row.openedBy ?? null,
      // crossingCheck's field is `refusal`, not `reason` — this was silently
      // dropping the actual message (e.g. the locked/shut wording) and
      // falling back to the node's generic "no way".
      reason: row.refusal ?? null,
    })),
    partySize: party.length,
  };
}

// ------------------------------------------------------------------ escort

// The party rack: who is standing here, who is already with you, and how many
// seats your mount has. One round trip, polled by the panel the way HereList
// polls its own list — somebody walking up to you has to appear.
export async function loadParty() {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const character = me.character;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const [candidates, party, incoming] = await Promise.all([
    escortCandidates(prisma, character, openTurn?.number ?? null),
    partyOf(prisma, character.id),
    // Asks aimed at THIS character. The Discord buttons are unreachable for a
    // web-only player, so the rack answers them too.
    prisma.offer.findMany({
      where: { kind: "ESCORT", status: "PENDING", responderId: character.id },
      select: { id: true, initiatorId: true },
    }),
  ]);

  // Offer.initiatorId is a bare column, not a relation — every other reader
  // resolves the name with its own lookup (db/lib/escort.js, lessons.js,
  // confession.js). Selecting `initiator` here threw a validation error on
  // every poll instead, which took the whole party rack down with it.
  const askerNames = new Map();
  if (incoming.length) {
    const askers = await prisma.character.findMany({
      where: { id: { in: [...new Set(incoming.map((o) => o.initiatorId))] } },
      select: { id: true, name: true },
    });
    for (const asker of askers) askerNames.set(asker.id, asker.name);
  }

  return {
    ok: true,
    seats: fastTravelCapacity(equippedSlugs(character.tags ?? [])),
    candidates,
    // The rack draws this, in the order they were picked up. Its verdict is
    // re-derived rather than read off `candidates`: a follower can be with you
    // and no longer be a candidate, which is exactly the state a stale
    // attachment leaves and exactly what the rack has to keep showing.
    party: party.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      reason: escortReason(row, escortAuthority(character, row, openTurn?.number ?? null)),
    })),
    incoming: incoming.map((offer) => ({ id: offer.id, from: askerNames.get(offer.initiatorId) ?? "Somebody" })),
  };
}

// Pick somebody up. FORCED and CONSENTED attach at once; anyone else is asked
// and attaches only when they accept. The verdict is re-derived here — the
// panel's is a hint, and this is a public endpoint.
export async function bringAlong(targetId) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const target = await prisma.character.findUnique({ where: { id: targetId ?? "" }, select: MOVER_SELECT });
  const verdict = escortAuthority(me.character, target, openTurn?.number ?? null);
  // Says WHICH rule refused. The picker only lists people you can take, so a
  // refusal here means the world moved between the list and the click, and
  // "you can't" with no reason left the player staring at somebody standing
  // in front of them.
  if (!verdict) return { ok: false, error: escortRefusal(me.character, target) };

  if (verdict === "ASK") {
    if (!openTurn) return { ok: false, error: "No turn is open." };
    const offer = await createEscortOffer(prisma, { actor: me.character, target, turn: openTurn });
    if (!offer.ok) return { ok: false, error: offer.reason };
    await sendDm(offer.dm.discordUserId, offer.dm.content, { components: offer.dm.components, meta: offer.dm.meta }).catch(() => {});
    return { ok: true, line: `You asked ${target.name} to come with you.` };
  }

  // A FORCED target is taken, not agreed with, so somebody else holding the
  // column is not a reason to refuse — escortAuthority already decided that
  // above and attach must not re-decide it (db/lib/escort.js).
  if (!(await attach(prisma, me.character.id, target.id, { takeover: verdict === "FORCED" }))) {
    return { ok: false, error: "Somebody else has them." };
  }
  return { ok: true, line: `${target.name} is with you.` };
}

// Put somebody down. Always allowed: letting go is never gated.
export async function putDown(targetId) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const target = await prisma.character.findFirst({
    where: { id: targetId ?? "", escortedById: me.character.id },
    select: { id: true, name: true },
  });
  if (!target) return { ok: false, error: "They aren't with you." };
  await detach(prisma, target.id);
  return { ok: true, line: `You let ${target.name} go.` };
}

// Answering an ask from the web, for a player who never opens Discord. The
// same two functions the bot's buttons call, so the two faces cannot drift.
export async function answerEscort({ offerId, accept } = {}) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const offer = await prisma.offer.findFirst({
    where: { id: offerId ?? "", kind: "ESCORT", status: "PENDING", responderId: me.character.id },
  });
  if (!offer) return { ok: false, error: "That offer's gone." };

  const result = accept
    ? await acceptEscort(prisma, offer, me.character)
    : await declineOffer(prisma, offer, me.character);
  for (const dm of result.dms ?? []) {
    await sendDm(dm.discordUserId, dm.content).catch(() => {});
  }
  return result.ok ? { ok: true, line: result.line } : { ok: false, error: result.reason };
}

export async function travelTo({ locationId } = {}) {
  const me = await actor(MOVER_SELECT);
  if (me.error) return { ok: false, error: me.error };

  const target = await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } });
  if (!target) return { ok: false, error: "That place no longer exists." };

  // Who comes along is read off Character.escortedById inside the move's own
  // transaction — nothing is posted from the browser, so there is nothing to
  // re-authorize here (MAP.md §3a).
  const result = await performLocationMove(prisma, me.character, target);
  if (!result.ok) return { ok: false, error: result.reason };

  // Followers the way would not take: already detached, still standing where
  // they were. The leader's line must not name the reason — a hidden crawl's
  // refusal would announce that the crawl is there (MAP.md §2a).
  const stranded = [];
  const heldBack = [];
  for (const entry of result.leftBehind ?? []) {
    // "held" is the one reason the leader IS told, because it is plain to see:
    // somebody has hold of them. Every other reason stays unnamed.
    (entry.reason === "held" ? heldBack : stranded).push(entry.character.name);
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(entry.character.discordUserId, `*${me.character.name} went on without you.*`).catch(() => {});
  }

  // Sequential on purpose: each entry is a handful of REST calls, and firing
  // a whole dragged party's worth at once is the shape that trips the
  // invalid-response breaker (db/lib/discordRest.js).
  for (const entry of result.moved) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: entry.character.id,
      fromLocationId: entry.fromLocationId,
      toLocationId: entry.toLocationId,
      // Only ever computed for the mover themselves — performLocationMove
      // checks the mover's own equipped mount against the edge, never a
      // dragged passenger's.
      dismounted: entry.character.id === me.character.id ? result.dismounted : undefined,
    }).catch(() => {});
  }
  // The Caving Die's "on arrival" trigger (CAVING.md), and the word owed to
  // anybody who was carried off without pressing anything.
  for (const entry of result.moved) {
    if (entry.cavingDm) await sendDm(entry.cavingDm.discordUserId, entry.cavingDm.content).catch(() => {});
  }
  // Anybody who was laying in wait here (INTERCEPT.md). Built inside
  // performLocationMove and sent out here, the same split cavingDm uses.
  for (const dm of result.interceptDms ?? []) {
    await sendDm(dm.discordUserId, dm.content, {
      kind: dm.kind,
      authorDiscordUserId: dm.authorDiscordUserId ?? null,
      components: dm.components,
      meta: dm.meta,
      // Player-typed text rides in these. cleanMessage() already took the
      // broadcast pings out of the stored copy; this is the belt to that
      // pair of braces, and it costs nothing.
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
  const brought = [];
  for (const entry of result.moved) {
    if (entry.character.id === me.character.id) continue;
    brought.push(entry.character.name);
    if (entry.character.status !== "ALIVE" || !entry.character.discordUserId) continue;
    await sendDm(
      entry.character.discordUserId,
      `*${me.character.name} brought you along to ${target.name}.*`,
    ).catch(() => {});
  }

  const parts = [`Moved to ${target.name}.`];
  if (result.usedFreeMove) {
    parts.push(
      result.freeMovesLeft > 0
        ? `${result.freeMovesLeft} free ${result.freeMovesLeft === 1 ? "move" : "moves"} left this turn.`
        : "That was your last free move this turn.",
    );
  }
  if (result.spentTurn) parts.push("That crossing spent your Move.");
  if (brought.length > 0) parts.push(`Bringing ${brought.join(", ")}.`);
  if (stranded.length > 0) parts.push(`You can't move ${stranded.join(", ")} through here.`);
  if (heldBack.length > 0) parts.push(`Somebody has hold of ${heldBack.join(", ")}.`);
  // A way too narrow for what they had out. This used to be said only on the
  // deferred branch, so a free crossing dismounted a rider and told them
  // nothing; every crossing lands here now, so it is said once, here.
  if (result.dismounted.length > 0) {
    return { ok: true, line: `${parts.join(" ")} ${dismountedMessage(result.dismounted)}` };
  }
  return { ok: true, line: `${parts.join(" ")}` };
}

// ------------------------------------------------------------------- gates

export async function flipGate(linkId) {
  const me = await actor(GATE_CHARACTER_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const result = await toggleGate(prisma, {
    character: me.character,
    linkId,
    actorDiscordUserId: me.discordUserId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  // Redrawing the Discord anchor and the watchtower's starter is a
  // Discord-only follow-up and stays with the bot, which owns those messages
  // — the gate itself is already flipped either way, so nothing here waits
  // on it. The bot redraws on its own click and on the next channel doctor
  // pass.
  return { ok: true, line: result.line };
}

export async function holdKeyed(linkId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await holdKeyedOpen(prisma, { discordUserId: me.discordUserId, linkId, hold: true });
  return result.ok ? { ok: true, line: result.line, note: result.note } : { ok: false, error: result.error };
}

// ------------------------------------------------------------- noticeboard

// A paper's whole Tag row, because paperDescription and readBlock both need
// it — a `select` beside a nested `include` is not a shape Prisma accepts.
const BOARD_ACTOR_SELECT = {
  id: true,
  name: true,
  locationId: true,
  discordUserId: true,
  tags: { select: { tagId: true, equipped: true, tag: true } },
};

// The board where this character is standing. The LOAD is
// db/lib/noticeboard.js#boardFor, which is Location-keyed and knows nothing
// about who is asking; the actor gate — you have to be standing here — is
// this line, and it stays on this side.
async function boardHere(character) {
  return boardFor(prisma, character.locationId);
}

export async function readBoard() {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };

  // Written or sealed, and never gated on whether they can read it: pinning
  // up a letter you cannot read yourself is a perfectly good thing to do.
  const holding = me.character.tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .slice(0, BOARD_OPTION_LIMIT)
    .map((ct) => ({ tagId: ct.tagId, name: ct.tag.name, sealed: ct.tag.paperKind === "SEALED" }));

  return {
    ok: true,
    heading: boardText(ctx.location.name, ctx.posts, ctx.openTurn?.number ?? 0),
    notices: ctx.posts.map((p) => ({ id: p.id, name: p.tag.name })),
    holding,
  };
}

export async function readNotice(postId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };

  const where = { phase: ctx.openTurn?.phase ?? null, indoors: ctx.location.indoors ?? true };
  // The same predicate the tag chip uses, and the same sentence — a blind
  // reader and an illiterate one get identical refusals, so neither the
  // reader nor anyone watching learns which it was.
  const reader = { tags: me.character.tags, ...where };
  const text = paperDescription(post.tag, reader);
  const blocked = Boolean(readBlock(me.character.tags, where)) || post.tag.paperKind === "SEALED";
  // Nobody is told it was read. `paper` is what PaperSheet.js draws; `text`
  // and `plain` stay for anything still reading the flat shape.
  return { ok: true, name: post.tag.name, text, plain: blocked, paper: paperView(post.tag, reader) };
}

export async function tearNotice(postId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };

  // The delete IS the claim, so two people tearing at the same paper cannot
  // both walk away with it.
  const claimed = await prisma.noticePost.deleteMany({ where: { id: post.id } });
  if (claimed.count === 0) return { ok: false, error: "Somebody got there first." };
  await addToStack(prisma, me.character.id, post.tagId, 1, {});

  if (ctx.location.discordChannelId) {
    // Catch-logged: an unreachable channel must never undo a tear that has
    // already committed (ARCHITECTURE.md §5).
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => {});
  }
  // The same row the bot's board writes (db/lib/scene.js) — a tear on the web
  // and a tear on Discord are one event, and Chat shows both.
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name) });
  return { ok: true, line: `You take ${post.tag.name} down.` };
}

export async function pinNotice(tagId) {
  const me = await actor(BOARD_ACTOR_SELECT);
  if (me.error) return { ok: false, error: me.error };
  const ctx = await boardHere(me.character);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!ctx.openTurn) return { ok: false, error: "Nothing is happening yet." };

  const held = me.character.tags.find((ct) => ct.tagId === tagId);
  // "Has a paperKind" is not the check: a spent envelope and a bound book
  // both have one, and neither goes up on a wall.
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return { ok: false, error: "You aren't holding that." };
  }

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { noticeExpiryTurns: true } });
  // N turns means N turns, counting the one it went up in.
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  try {
    await prisma.$transaction(async (tx) => {
      // NoticePost.tagId is @unique: a paper is on a board or in somebody's
      // hands, never both. Creating first means a paper already pinned
      // somewhere else fails here rather than being silently taken off a
      // sheet and lost.
      await tx.noticePost.create({
        data: {
          locationId: ctx.location.id,
          tagId: held.tagId,
          postedById: me.character.id,
          postedTurn: ctx.openTurn.number,
          expiresTurn,
        },
      });
      await dropCharacterTag(tx, me.character.id, held.tagId, 1);
    });
  } catch (err) {
    if (err?.code === "P2002") return { ok: false, error: "That one is already up somewhere." };
    return { ok: false, error: "That didn't go up." };
  }

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(held.tag.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(held.tag.name) });
  return { ok: true, line: `You nail ${held.tag.name} up. Anyone here can read it, or take it down.` };
}

// ------------------------------------------------ the board, worked by a GM
//
// A GM has no body, so every gate the four actions above apply — are you
// alive, are you standing here, can you read — answers "no" for them. The
// board was the one public surface in the game the GMs could not touch.
//
// FOUR SEPARATE ACTIONS rather than a branch inside each of the four above.
// Three of them behave differently enough (no literacy gate, a tear that
// destroys, a post that mints paper out of nothing) that branching would make
// the player path harder to read for no gain, and a server action re-checks
// everything it was sent regardless.
//
// The gate is the SAME verdict chat/page.js uses to decide GM mode, so the
// page and the actions can never disagree about who is a GM. The board comes
// from the place the GM has open, which is the Discord half's rule too: there,
// the button lives on the anchor in that Location's own channel.
async function gmBoard(placeKey) {
  const { session, isGm } = await getGmSession();
  // The same sentence a characterless player gets from actor(). A GM reading
  // this is looking at a bug; anyone else is looking at a refusal that tells
  // them nothing about whether GM powers exist.
  if (!session?.discordUserId || !isGm) return { error: "You have no living character." };
  const parsed = parsePlaceKey(placeKey);
  if (parsed?.kind !== "loc") return { error: "There's no board here." };
  const ctx = await boardFor(prisma, parsed.id);
  if (ctx.error) return ctx;
  return { ...ctx, discordUserId: session.discordUserId };
}

export async function gmReadBoard(placeKey) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  // No `holding`: a GM has no paper to pin, which is the whole reason the
  // dialog gives them a writing form where a player gets a picker.
  return {
    ok: true,
    heading: boardText(ctx.location.name, ctx.posts, ctx.openTurn?.number ?? 0),
    notices: ctx.posts.map((p) => ({ id: p.id, name: p.tag.name })),
  };
}

export async function gmReadNotice(placeKey, postId) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };
  // A GM sees everything, wax seal included. readBlock reads a tag list, and
  // a GM's is empty — the ordinary gate would call them illiterate and refuse
  // every notice on every board, so the panel would open onto nothing it
  // could ever show. Reading is silent either way; nobody is told.
  const text = (post.tag.paperText ?? "").trim();
  return {
    ok: true,
    name: post.tag.name,
    text,
    plain: false,
    paper: { kind: post.tag.paperKind ?? null, text, plain: false },
  };
}

export async function gmTearNotice(placeKey, postId) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  const post = ctx.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, error: "It's gone." };

  // The delete IS the claim, the same as a player's tear — and the paper goes
  // with the post, because a GM has nothing to hold it in. That is what the
  // expiry sweep does to a notice that blew away, so nothing new is invented
  // here (db/lib/noticeboard.js#destroyNotice).
  const claimed = await destroyNotice(prisma, post);
  if (claimed.count === 0) return { ok: false, error: "Somebody got there first." };

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: ctx.discordUserId,
        actionType: "gm_tear_notice",
        details: {
          locationId: ctx.location.id,
          locationName: ctx.location.name,
          tagName: post.tag.name,
          face: "web",
        },
      },
    })
    .catch((err) => console.error("Notice audit log failed:", err));

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name) });
  return { ok: true, line: `You take ${post.tag.name} down.` };
}

export async function gmPostNotice(placeKey, { title: rawTitle = "", body: rawBody = "" } = {}) {
  const ctx = await gmBoard(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  if (!ctx.openTurn) return { ok: false, error: "Nothing is happening yet." };

  // The title is CLEANED and the body is only trimmed — exactly what a
  // player's own Write does (character/paperActions.js). A paper's NAME is
  // interpolated raw into bot messages, so an "@" in one is a mention waiting
  // to happen; a body is only ever shown through PaperSheet or inside a code
  // block, and it keeps its line breaks because a proclamation signed on its
  // own line should stay signed on its own line.
  const title = cleanCustomText(rawTitle, TITLE_MAX) || null;
  const body = String(rawBody ?? "").trim().slice(0, WRITE_MAX);
  if (!body) return { ok: false, error: "Write something first." };

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { noticeExpiryTurns: true },
  });
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  // MINTED OUTSIDE A TRANSACTION. createWithRetry re-rolls the slug on a
  // unique collision, and Postgres aborts the whole transaction on the first
  // failed statement (25P02), so a retry inside one throws instead of
  // retrying — db/lib/paperMint.js spells the trap out.
  //
  // paperAuthor takes the GM's Discord id, and nothing renders it anywhere. It
  // is for the audit trail only: a notice is anonymous on the board, which is
  // the point of a public board.
  const paper = await mintUnownedPaper(
    prisma,
    `gm-notice-${ctx.location.id}`,
    ctx.discordUserId,
    body,
    title,
  );

  try {
    await prisma.noticePost.create({
      data: {
        locationId: ctx.location.id,
        tagId: paper.id,
        // Nobody pinned it. The column is nullable for its own reason — a
        // notice outlives the person who put it up — and this is the shape a
        // Wanted poster already lands in (db/lib/wantedPoster.js).
        postedById: null,
        postedTurn: ctx.openTurn.number,
        expiresTurn,
      },
    });
  } catch (err) {
    // The paper exists and the board refused it, so it would be an orphan
    // nothing can ever reach. Take it back out.
    await prisma.tag.deleteMany({ where: { id: paper.id, ephemeral: true } }).catch(() => {});
    if (err?.code === "P2002") return { ok: false, error: "That one is already up somewhere." };
    return { ok: false, error: "That didn't go up." };
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: ctx.discordUserId,
        actionType: "gm_post_notice",
        details: {
          locationId: ctx.location.id,
          locationName: ctx.location.name,
          tagId: paper.id,
          tagName: paper.name,
          face: "web",
        },
      },
    })
    .catch((err) => console.error("Notice audit log failed:", err));

  // THE SAME LINE A PLAYER'S PIN RAISES. It names the paper and never the
  // person, so nobody in the room can tell a GM's notice from anyone else's —
  // which is exactly why the line was written that way.
  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(paper.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(paper.name) });
  return { ok: true, line: `You nail ${paper.name} up. Anyone here can read it, or take it down.` };
}

// ------------------------------------------------- the place, read by a GM
//
// What GmAside.js draws. A player's whole right column is built once in
// page.js, because a player stands in one place and the page is re-rendered
// when they move. A GM stands nowhere and changes place by clicking, so the
// same shape would mean re-rendering the server tree on every click — which is
// the exact thing CHAT.md §1 says this page does not do.
//
// So it is an action the column calls on the place it has open, the way
// RoomPanel's readStash and TravelNodes' loadTravel already work. Everything
// below is location-keyed and already exists: this composes, it decides
// nothing.
//
// THE GATE IS THE SAME ONE THE PLACE LIST APPLIES. gmPlacesFor only lists
// places inside visibleZoneIds, so reading one through here that the column
// could not have offered would make this action the way around the zone view.
// A server action is a public endpoint (CLAUDE.md), so it is re-checked here
// rather than trusted from the click.
async function gmPlace(placeKey) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) return { error: "You have no living character." };

  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { error: "Nowhere to look." };

  // Every kind resolved down to the Location it belongs to, which is what the
  // readouts below all take. A zone has none, and neither does a net.
  let locationId = null;
  let conversationId = null;
  let roomId = null;
  let zoneId = null;
  if (parsed.kind === "loc") {
    locationId = parsed.id;
  } else if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({
      where: { id: parsed.id },
      select: { id: true, locationId: true },
    });
    if (!room) return { error: "That room is gone." };
    roomId = room.id;
    locationId = room.locationId;
  } else if (parsed.kind === "conv") {
    const conversation = await prisma.playerThread.findUnique({
      where: { id: parsed.id },
      select: { id: true, locationId: true },
    });
    if (!conversation) return { error: "That conversation is gone." };
    conversationId = conversation.id;
    locationId = conversation.locationId;
  } else if (parsed.kind === "zone") {
    zoneId = parsed.id;
  }

  const location = locationId
    ? await prisma.location.findUnique({
        where: { id: locationId },
        select: {
          id: true,
          name: true,
          description: true,
          attributes: true,
          discordChannelId: true,
          zone: { select: { id: true, name: true, description: true } },
        },
      })
    : null;
  if (locationId && !location) return { error: "That place is gone." };

  const scopeZoneId = location?.zone?.id ?? zoneId ?? null;
  const allowed = await visibleZoneIds(prisma, session.discordUserId);
  if (allowed && scopeZoneId && !allowed.has(scopeZoneId)) {
    return { error: "That is not one of the zones you are watching." };
  }

  return { session, location, locationId, roomId, conversationId, zoneId };
}

export async function gmPlaceView(placeKey) {
  const ctx = await gmPlace(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };
  const { location, locationId, roomId, conversationId, zoneId } = ctx;

  // A radio net belongs to no zone and no Location (CHAT.md §5d), so there is
  // nothing place-shaped to say about one. Answered plainly rather than with
  // an empty column, which reads as a column that failed to load.
  if (!locationId && !zoneId) {
    return { ok: true, placeKey, kind: "net" };
  }

  // A zone summary is the zone and its Locations, and nothing else: a GM
  // reading #summary is not standing in any of them.
  if (!locationId) {
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      select: {
        id: true,
        name: true,
        description: true,
        locations: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    });
    if (!zone) return { ok: false, error: "That zone is gone." };
    return {
      ok: true,
      placeKey,
      kind: "zone",
      zone: { name: zone.name, description: zone.description ?? "" },
      locations: zone.locations.map((l) => ({ id: l.id, name: l.name })),
    };
  }

  const [examined, people, rooms, links, structures, members] = await Promise.all([
    examineLines(prisma, locationId),
    whosHereGm(prisma, locationId),
    prisma.room.findMany({
      where: { locationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        accessTagSlugs: true,
        resources: true,
        tags: {
          where: { quantity: { gt: 0 } },
          orderBy: { tag: { name: "asc" } },
          select: { tagId: true, quantity: true, tag: { select: { name: true, description: true } } },
        },
      },
    }),
    linksFor(prisma, locationId),
    structuresAt(prisma, locationId),
    conversationId ? conversationMembers(prisma, conversationId, null, { gm: true }) : Promise.resolve(null),
  ]);

  // The place-only half of the affordance catalog — the half an anchor can
  // carry, which is exactly the half that is true of a place rather than of a
  // person (db/lib/placeAffordances.js). Travel and Who's here? are dropped
  // for the same reason ChatAside drops them: this column answers both by
  // being on the page.
  const fixtures = locationAffordances(location)
    .filter((entry) => entry.id !== "travel" && entry.id !== "whosHere" && entry.id !== "examine")
    .map((entry) => ({ id: entry.id, label: entry.label, tone: entry.tone }));

  // Every modular way out and what it is doing, read through the graph rather
  // than off a button — the reason examineLines reads it that way too.
  const ways = (links ?? [])
    .map((link) => {
      const far = endpoints(link, locationId).far;
      return {
        linkId: link.id,
        farName: far?.name ?? "somewhere",
        modular: Boolean(link.modular),
        isOpen: Boolean(link.isOpen),
        keyed: Boolean(link.keyed),
        held: link.keyed ? isHeldOpen(link) : false,
      };
    })
    .sort((a, b) => a.farName.localeCompare(b.farName));

  const openRoom = roomId ? rooms.find((room) => room.id === roomId) ?? null : null;

  return {
    ok: true,
    placeKey,
    kind: roomId ? "room" : conversationId ? "conv" : "loc",
    place: { id: location.id, name: location.name, description: location.description ?? "" },
    zone: { name: location.zone?.name ?? "", description: location.zone?.description ?? "" },
    // examineLines returns { ok, name, lines } or { ok: false, error }.
    lines: examined?.ok ? examined.lines : [],
    fixtures,
    people,
    ways,
    // typeName is the snapshot column, so a structure keeps the name it was
    // raised under even if the tag behind it is renamed later — the same
    // reasoning every other log column in this schema follows.
    structures: (structures ?? []).map((s) => ({
      id: s.id,
      name: s.typeName,
      status: s.status,
      turnsDone: s.turnsDone,
      turnsNeeded: s.turnsNeeded,
    })),
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      private: room.kind === "PRIVATE",
      keys: room.accessTagSlugs ?? [],
      resources: room.resources ?? 0,
      things: room.tags.map((t) => ({ id: t.tagId, name: t.tag.name, quantity: t.quantity })),
    })),
    openRoom: openRoom
      ? {
          id: openRoom.id,
          name: openRoom.name,
          private: openRoom.kind === "PRIVATE",
          keys: openRoom.accessTagSlugs ?? [],
          resources: openRoom.resources ?? 0,
          things: openRoom.tags.map((t) => ({ id: t.tagId, name: t.tag.name, quantity: t.quantity })),
          fixtures: roomAffordances(openRoom).map((entry) => ({
            id: entry.id,
            label: entry.label,
            tone: entry.tone,
          })),
        }
      : null,
    members,
  };
}

// The same ceiling /gm/dev's ambient form applies. One line of scenery, not a
// monologue — and the two boxes write the same kind of row, so they cannot
// sensibly disagree about how long one may be.
const AMBIENT_MAX = 1500;

// A line the world says into the place a GM has open.
//
// The same thing /gm/dev's ambient form does, with the picker removed: the
// column already knows where the GM is reading, and re-choosing the place from
// a dropdown you just clicked is the friction that kept this on a page three
// clicks away. One text box, the place you are looking at.
//
// It goes through db/lib/placeLine.js like every other line of scenery, so the
// Discord post and the ArchiveEntry happen together and a web-only player sees
// it too. `-#` is per line and ambientLine owns that rule — never write the
// prefix here (CLAUDE.md, "Bot message style").
//
// THREE KINDS ONLY, matching the ambient form's own targets. A conversation is
// a private thread somebody opened to talk in, and a radio net is a frequency
// rather than a room; scenery belongs in neither, and refusing plainly beats
// offering a box that posts somewhere surprising.
export async function gmSayHere(placeKey, text) {
  const ctx = await gmPlace(placeKey);
  if (ctx.error) return { ok: false, error: ctx.error };

  const said = String(text ?? "").trim();
  if (!said) return { ok: false, error: "Write the line first." };
  if (said.length > AMBIENT_MAX) return { ok: false, error: "That is too long for one line of scenery." };

  // A place with no channel is refused BEFORE anything is written, which is
  // ambientTarget's own rule and not merely tidiness: placeLine writes the
  // archive row whether or not the Discord half lands, so posting first and
  // checking after would put a line in the transcript that was never said
  // anywhere. The cave levels are the real case — `Caves`, `Depths` and
  // `Underground` carry no `#summary` channel, and a GM can open all three.
  const parsed = parsePlaceKey(placeKey);
  let target = null;
  let details = null;
  if (parsed.kind === "room") {
    const room = await prisma.room.findUnique({
      where: { id: parsed.id },
      select: { id: true, name: true, discordThreadId: true },
    });
    if (!room) return { ok: false, error: "That room is gone." };
    if (!room.discordThreadId) return { ok: false, error: "That room has no thread yet." };
    target = () => roomLine(prisma, room, said);
    details = { kind: "room", targetId: room.id, targetName: room.name };
  } else if (parsed.kind === "loc") {
    const location = ctx.location;
    if (!location.discordChannelId) return { ok: false, error: "That location has no channel yet." };
    target = () => locationLine(prisma, location, said);
    details = { kind: "location", targetId: location.id, targetName: location.name };
  } else if (parsed.kind === "zone") {
    const zone = await prisma.zone.findUnique({
      where: { id: parsed.id },
      select: { id: true, name: true, discordSummaryChannelId: true },
    });
    if (!zone) return { ok: false, error: "That zone is gone." };
    if (!zone.discordSummaryChannelId) return { ok: false, error: "That zone has no #summary channel yet." };
    target = () => zoneLine(prisma, zone, said);
    details = { kind: "zone", targetId: zone.id, targetName: `${zone.name} — #summary` };
  } else {
    return { ok: false, error: "Scenery needs somewhere to happen. Open a place first." };
  }

  const result = await target();
  // The archive half has already happened by here, so the refusal says which
  // half missed — see sendAmbientLine for the same sentence and the reason.
  if (!result.posted) {
    return {
      ok: false,
      error: result.archived
        ? "Discord refused it — but it is on the web already, so say it again there and it will read twice."
        : "Discord refused it. Nothing was said.",
    };
  }

  // The SAME actionType the ambient form writes, so /gm/audit answers "who
  // said that" with one filter however the line was typed. `face` says which
  // surface it came from, the way gm_post_notice already does.
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: ctx.session.discordUserId,
        actionType: "gm_ambient_line",
        details: { ...details, text: said, face: "chat" },
      },
    })
    .catch((err) => console.error("Ambient line audit log failed:", err));

  return { ok: true, line: `Said in ${details.targetName}.` };
}

// ------------------------------------------------------------- conversation

export async function converseRooms() {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const [rooms, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: me.character.locationId ?? "", discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true },
      orderBy: { sortOrder: "asc" },
    }),
    roomAccessKeys(prisma, me.character.id),
  ]);
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds);
  return { ok: true, rooms: open.map((r) => ({ id: r.id, name: r.name, private: r.kind === "PRIVATE" })) };
}

// How many people one Converse may seat besides the opener. The dialog ticks
// at most one; this is the bound on a hand-posted list, since each hood token
// in it costs a presence query to resolve.
const INVITE_LIMIT = 10;

// `inviteRefs` are character ids, or the bare hood token a concealed row
// carries instead of one — the same pair lookAt, addMember and removeMember
// take, told apart the same way.
export async function openConversation({ roomId, name, inviteRefs = [] } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };

  const trimmed = String(name ?? "").trim().slice(0, 90);
  if (!trimmed) return { ok: false, error: "Give it a name." };

  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { location: true } });
  if (!room) return { ok: false, error: "That room no longer exists." };
  if (me.character.locationId !== room.locationId) {
    return { ok: false, error: `You're not in ${room.location.name} any more.` };
  }
  if (!room.location.discordChannelId) {
    return { ok: false, error: "That place has no channel yet — tell a GM." };
  }
  // The same locked-door rule the Discord picker applies.
  const keys = await roomAccessKeys(prisma, me.character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds).length === 0) {
    return { ok: false, error: "You can't get in there." };
  }

  // The one copy of the open sequence, shared with the bot's Converse modal
  // and with Xom's turn pass — see db/lib/conversationOpen.js.
  const opened = await openConversationThread(prisma, {
    locationId: room.locationId,
    roomId: room.id,
    name: trimmed,
    characterIds: [me.character.id],
    creatorCharacterId: me.character.id,
  });
  if (!opened.ok) return { ok: false, error: opened.error };
  const { conversation } = opened;
  const thread = { id: opened.threadId };

  // Anybody the dialog was opened ON. Converse hangs off a person's row, so
  // the person whose row it was is ticked when it opens — and this is where
  // that tick becomes a membership row. What the browser sent is never
  // trusted: a hood token resolves only against the people actually standing
  // with this character, and an id is then re-checked for ALIVE and the same
  // Location, which is the co-presence rule every other people action uses.
  // An unresolvable ref is dropped the way a bad id has always been.
  // Capped: each hood token costs a presence query, and the dialog sends at
  // most one. A longer list is somebody posting by hand.
  const refs = [...new Set((Array.isArray(inviteRefs) ? inviteRefs : []).map(String))]
    .filter(Boolean)
    .slice(0, INVITE_LIMIT);
  const sightings = refs.some((ref) => HOOD_TOKEN.test(ref)) ? await lastSightings(prisma, me.character) : null;
  const resolved = await Promise.all(
    refs.map((ref) => (HOOD_TOKEN.test(ref) ? resolveHoodToken(prisma, me.character, ref, { sightings }) : ref)),
  );
  const wanted = [...new Set(resolved.filter(Boolean))].filter((id) => id !== me.character.id);
  if (wanted.length > 0) {
    const guests = await prisma.character.findMany({
      where: { id: { in: wanted }, status: "ALIVE", locationId: room.locationId },
      select: { id: true, discordUserId: true, webOnly: true },
    });
    for (const guest of guests) {
      // The ROW first, then the account: membership is a database fact and
      // Discord is its projection, so a failed thread add never decides
      // whether the conversation is in somebody's places.
      await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: guest.id });
      if (guest.discordUserId && !guest.webOnly) {
        await addThreadMember(thread.id, guest.discordUserId).catch(() => {});
      }
    }
  }
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "conversation_opened",
        targetCharacterId: me.character.id,
        details: { threadId: thread.id, name: trimmed, room: room.name, location: room.location.name },
      },
    })
    .catch(() => {});

  // Say so when the person you opened it FOR did not come. They walked off
  // between ticking the box and pressing the button, or they were never
  // reachable — either way the room is empty and the old line said "Opened"
  // and let you find that out by talking to nobody.
  const missed = refs.length > 0 && wanted.length === 0;
  return {
    ok: true,
    line: missed ? "Opened, but they aren't here any more — add them when they turn up." : "Opened. It is in your places now.",
  };
}

// ------------------------------------------------------- bell, PA, the gun

// Pray, at the Shrine of an Old Man. A confirm rather than the bell's
// type-the-word dialog, and the difference is the point: RING is a speed bump
// on a LOUD act, and this disturbs nobody — it hands you a permanent tag that
// can kill you and shuts every goal on your sheet but one. The friction that
// suits that is being told what the bargain is, which the dialog does.
export async function pray({ roomId } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, XOM_SHRINE_ROOM_SLUG, "There's no shrine here.");
  if (found.error) return { ok: false, error: found.error };

  // The same locked-door rule Discord applies. A server action is a public
  // endpoint, so the door is re-checked here and not trusted from the panel
  // that drew the button.
  const keys = await roomAccessKeys(prisma, me.character.id);
  if (accessibleRooms([found.room], keys.heldSlugs, keys.guestRoomIds).length === 0) {
    return { ok: false, error: "You can't get in there." };
  }

  const result = await grantXom(prisma, { characterId: me.character.id });
  if (result.already) return { ok: false, error: "The face is already watching you." };
  if (result.spoken) {
    return { ok: false, error: "Something else has you already, and it does not share." };
  }
  if (!result.ok) return { ok: false, error: "Nothing answers. Tell a GM." };

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "xom_prayed",
        targetCharacterId: me.character.id,
        details: { characterName: me.character.name, room: found.room.name, replaced: result.replaced },
      },
    })
    .catch(() => {});

  // Anybody else standing in the shrine sees it. Nothing leaves the room —
  // the tag is `catalog: secret`, and this is the only place it is ever
  // announced at all.
  const witnessed = `${me.character.name} kneels, and the face seems to lean down.`;
  await sceneLineAt(prisma, { roomId: found.room.id, text: witnessed }).catch(() => {});
  const thread = await prisma.room
    .findUnique({ where: { id: found.room.id }, select: { discordThreadId: true } })
    .catch(() => null);
  if (thread?.discordThreadId) {
    await postMessage(thread.discordThreadId, ambientLine(witnessed)).catch(() => {});
  }

  return {
    ok: true,
    line: result.replaced
      ? `It takes your ${result.replaced} off you and does not offer anything back.`
      : "Something old and amused turns its attention on you.",
  };
}

export async function ringBell({ roomId, word } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, BELL_ROOM_SLUG, "There's no bell here.");
  if (found.error) return { ok: false, error: found.error };
  if (!bellWordMatches(word)) return { ok: false, error: `Type ${RING_WORD} to pull the rope.` };

  // Read AFTER the word, so an abandoned dialog never reports a wait it was
  // not going to trigger anyway.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { bellRungAt: true } });
  const { ok, secondsLeft } = bellCooldown(state?.bellRungAt);
  if (!ok) {
    // Minutes, not raw seconds: at a half-hour cooldown "1487s" is arithmetic
    // homework rather than an answer.
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    return {
      ok: false,
      error: `The bell is still humming from the last pull. About ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  await prisma.gameState.update({ where: { id: 1 }, data: { bellRungAt: new Date() } });
  const { sent, failed } = await broadcastBell(prisma);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "bell_rung",
        targetCharacterId: me.character.id,
        details: { characterName: me.character.name, sent, failed },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    // Bascinet's wording, and the same on both faces — the bot's twin in
    // bot/src/events/interactionCreate.js says exactly this. Which places
    // Discord refused is a fact about Discord, not about the barony, so the
    // names stay in soundBroadcast.js's console.error and the audit row above
    // and the ringer hears none of it.
    line: "The bell sounds.",
  };
}

export async function turretState(roomId) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There isn't a button here.");
  if (found.error) return { ok: false, error: found.error };
  const armed = await gatehouseTurretArmed(prisma);
  return { ok: true, armed, word: armed ? DISARM_WORD : ARM_WORD };
}

export async function toggleTurret({ roomId, word } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, null, "There isn't a button here.");
  if (found.error) return { ok: false, error: found.error };

  // Re-read rather than trusting what the dialog was drawn against — two
  // people in the office can open it in the same moment, and the word they
  // were asked to type is what says which way they meant to throw it.
  const armed = await gatehouseTurretArmed(prisma);
  if (!turretWordMatches(word, armed)) {
    return { ok: false, error: `Type ${armed ? DISARM_WORD : ARM_WORD} to confirm.` };
  }

  const next = !armed;
  await prisma.gameState.update({ where: { id: 1 }, data: { gatehouseTurretArmed: next } });

  // The yard hears it, and that is the only warning anybody in it gets. Best
  // effort — the switch is thrown either way.
  const gatehouse = await prisma.location
    .findUnique({ where: { slug: GATEHOUSE_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (gatehouse?.discordChannelId) {
    const line = next ? TURRET_ARMED_LINE : TURRET_DISARMED_LINE;
    await postMessage(gatehouse.discordChannelId, ambientLine(line.text, [], { signed: line.signed })).catch(() => {});
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "gatehouse_turret_toggled",
        details: { armed: next, characterId: me.character.id, characterName: me.character.name },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: next
      ? "The button toggles on."
      : "The button toggles off.",
  };
}

export async function speakOnIntercom({ roomId, body } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const found = await roomHere(me.character, roomId, INTERCOM_ROOM_SLUG, "There's no intercom here.");
  if (found.error) return { ok: false, error: found.error };

  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "Say something first." };

  const voice = await loadVoiceState(prisma, me.character.id);
  if (voice.block) return { ok: false, error: `You can't get the words out — you're ${voice.block.name}.` };

  const { sent, failed } = await broadcastIntercom(prisma, text);

  // The transcript. One row for the broadcast, not one per zone — it was one
  // thing said, heard in several places. The speaker IS recorded even though
  // the channel line names nobody.
  await recordArchiveMessage(prisma, { character: me.character, content: text, channelKind: "intercom" }).catch(
    () => {},
  );
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: me.discordUserId,
        actionType: "intercom_broadcast",
        targetCharacterId: me.character.id,
        details: { body: text, zonesReached: sent, zonesFailed: failed },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    line: "Your voice goes out across Ravenheart.",
    note: failed.length > 0 ? `Nothing came through in ${failed.join(", ")}.` : null,
  };
}

// --------------------------------------------------------------------- you

export async function submitMove({ moveKind, description } = {}) {
  const me = await actor();
  if (me.error) return { ok: false, error: me.error };
  const result = await fileMove(prisma, {
    character: me.character,
    actorDiscordUserId: me.discordUserId,
    moveKind,
    description,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Filing is only half of it. The bot's modal
  // (bot/src/events/interactionCreate.js#handleMoveSubmit) confirms straight
  // after, and a Move that is never confirmed stays PENDING_TYPE: the staged
  // push (db/lib/stagedPush.js) skips it, the GM desk never lists it, and
  // re-filing is blocked — the player loses the turn and is told nothing.
  // Same call, same order, same arguments.
  const loaded = await prisma.action.findUnique({
    where: { id: result.action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
  const { roll } = await confirmMove(prisma, loaded, me.discordUserId, { laborRate: result.laborRate });

  // The bot answers in Discord markdown; this panel prints plain text, so the
  // same facts are said in words. The Gambit roll itself stays hidden until
  // the turn-end reveal, exactly as it does in Discord.
  const parts = ["Filed and locked in."];
  if (roll.gambit) parts.push("Results will be announced when the turn ends.");
  if (roll.resourceValue != null) {
    parts.push(`Your day's work (${roll.expression}) came to ${roll.resourceValue > 0 ? "+" : ""}${roll.resourceValue} ⬢.`);
    if (roll.bonusNote) parts.push(roll.bonusNote);
  }
  return { ok: true, line: parts.join(" ") };
}

// The turn card's own state, re-read: which turn is open, whether the Move
// window has shut, and the Move this character has already filed into it.
// Polled beside waitingOnYou, so a Move filed from Discord shows up here
// without a reload.
//
// A filed Move is final, so what comes back is what it says and nothing about
// changing it — no `editable`, no kind-change ration.
export async function myMove() {
  const me = await actor({ id: true });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, phase: true, startedAt: true },
  });
  if (!openTurn) return { ok: true, turn: null, move: null, characterId: me.character.id };

  const [frozen, action] = await Promise.all([
    clockFrozen(prisma),
    prisma.action.findFirst({
      where: { characterId: me.character.id, turnId: openTurn.id },
      select: {
        id: true,
        moveKind: true,
        description: true,
      },
    }),
  ]);
  const { cutoffAt, locked, hasLock } = moveWindow(openTurn, { clockFrozen: frozen });

  return {
    ok: true,
    turn: {
      number: openTurn.number,
      phase: openTurn.phase,
      // ISO, because a Date does not survive the trip to a client component
      // intact and the countdown ticks in the browser anyway. It is the
      // CUTOFF, not the turn's end — Moves stop three hours early
      // (db/lib/turnClock.js), and counting to the end named a time nothing
      // happens at.
      closesAt: hasLock && cutoffAt ? cutoffAt.toISOString() : null,
      locked,
      hasLock,
    },
    move: action ? { id: action.id, kind: action.moveKind, description: action.description } : null,
    // Whose Move this is. The dialog keys its unfiled draft on it, so two
    // characters signed in from the same browser never inherit each other's
    // half-written day.
    characterId: me.character.id,
  };
}

// What the Move dialog shows before a Labor is committed, and nothing more.
//
// The player used to learn that they cannot labor where they stand by pressing
// File it and reading the refusal afterwards — on the one action a turn that
// is final. resolveLaborRate already knows; this just asks it early.
//
// WORDS, never numbers. `qualityWord` is the same function the Examine button
// prints (db/lib/examineLocation.js), so this says exactly what anybody
// standing here can already read, and the min/max the rate resolver also
// returns is deliberately dropped on the floor: Examine is the only surface
// allowed to show a coefficient at all (docs/systemdocs/LABORING.md), and a
// range is that number with the disguise off.
const LABOR_TIER_LABELS = {
  basic: "Laboring",
  skilled: "Skilled Laboring",
  hunting: "Hunting",
  farming: "Farming",
  fishing: "Fishing",
  prospecting: "Prospecting",
  refining: "Refining",
  // No skill that pays here. An em dash rather than a word, because there is
  // no tier — the day still files, and it still earns nothing.
  unskilled: "—",
};

// The same fixed order the bot's Examine uses, so a player who has learned the
// shape in Discord reads it the same way here.
const LABOR_CONTEXT_KINDS = [
  { kind: "HUNTING", label: "Hunting" },
  { kind: "FARMING", label: "Farming" },
  { kind: "FISHING", label: "Fishing" },
  { kind: "PROSPECTING", label: "Prospecting" },
];

export async function moveContext() {
  const me = await actor({ id: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };

  const [location, rate] = await Promise.all([
    me.character.locationId
      ? prisma.location.findUnique({
          where: { id: me.character.locationId },
          select: { name: true, yields: { select: { kind: true, current: true } } },
        })
      : null,
    resolveLaborRate(prisma, me.character.id),
  ]);

  const byKind = new Map((location?.yields ?? []).map((row) => [row.kind, row.current]));

  return {
    ok: true,
    locationName: location?.name ?? null,
    yields: LABOR_CONTEXT_KINDS.map(({ kind, label }) => ({
      label,
      word: qualityWord(byKind.get(kind) ?? null),
    })),
    // The tier that would win, as its own name — "you would work Fishing".
    // Absent when the rate refuses, in which case `refusal` carries the why.
    tier: rate.ok ? (LABOR_TIER_LABELS[rate.tier] ?? null) : null,
    // Named, not summed: the number is the coefficient's cousin and stays out.
    tools: rate.ok ? (rate.tools ?? []).map((tool) => tool.name).filter(Boolean) : [],
    refusal: rate.ok ? null : (rate.reason ?? null),
    // The Godard Factory floor, where a day pays in cubes and the four yield
    // words above describe nothing (db/lib/refinery.js, FACTORY.md). The same
    // sentence the DM gets afterwards, shared from db/lib so the two faces
    // cannot drift. Null everywhere else, which is what the dialog branches on.
    refining: rate.ok && rate.refinery ? REFINERY_NOTE : null,
  };
}


// The Bascinet conversation (CHAT.md §2b): everything the game has said to
// this player by DM, and what they wrote back. The SAME rows the GM desk
// reads, through the SAME noise filter (web/lib/dmThread.js), from the other
// chair — so the two surfaces cannot disagree about what was said. The row
// shape strips the author: a player never learns which GM answered.
//
// Paged from the newest backwards by `beforeId`, with the desk's keyset
// (createdAt, id) — a turn push writes several rows into one millisecond, and
// a plain `createdAt <` would skip every row sharing the boundary's stamp.
//
// Gated on the ACCOUNT, not on a living character: the page itself is what
// requires one, and a player whose character died with the tab open should
// still be able to read what Bascinet said and write back — that is the
// moment they most want to.
const GM_THREAD_PAGE = 60;

async function account() {
  const session = await auth();
  if (!session?.discordUserId) return { error: "You are not signed in." };
  return { discordUserId: session.discordUserId };
}

export async function gmThread({ beforeId = null } = {}) {
  const me = await account();
  if (me.error) return { ok: false, error: me.error };

  let before = null;
  if (beforeId) {
    before = await prisma.directMessage.findFirst({
      where: { id: String(beforeId), discordUserId: me.discordUserId },
      select: { id: true, createdAt: true },
    });
  }

  const rows = await prisma.directMessage.findMany({
    where: withoutDmNoise(
      {
        discordUserId: me.discordUserId,
        ...(before
          ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }
          : {}),
      },
      { perspective: "player" },
    ),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: GM_THREAD_PAGE + 1,
    select: PLAYER_DM_SELECT,
  });
  const hasMore = rows.length > GM_THREAD_PAGE;
  // Which of this page's DM buttons are still worth drawing. Stamped here
  // rather than in the renderer, because "is this offer still open?" is a
  // database question (web/lib/dmActions.js).
  const character = await prisma.character.findFirst({
    where: { discordUserId: me.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  return {
    ok: true,
    hasMore,
    rows: await resolveDmActions(
      rows.slice(0, GM_THREAD_PAGE).reverse().map(playerDmRow),
      { discordUserId: me.discordUserId, characterId: character?.id ?? null },
    ),
  };
}

// A line to Bascinet, from Chat. One INBOUND row, exactly as the bot logs
// a DM typed into Discord (bot/src/events/messageCreate.js) — and nothing
// sent to Discord, because there is nothing to send: the bot cannot speak as
// the player in their own DM, the desk picks the row up on its poll like any
// inbound, and the GM's answer goes out through sendDm to Discord and the
// table both, so it reaches the player on whichever face they are on.
// `meta.via` says where it was typed, for a GM reading the record later.
//
// Two refusals the Discord path has no equivalent of. The Play switch
// (GameConfig.playPanelEnabled) is re-read here because a tab open when a GM
// flips it keeps its stream; and a plain cap on how fast one account may
// write, because every scene composer in Chat is throttled and this one
// is a pipe straight into the GM desk's inbox.
const TO_GMS_WINDOW_MS = 60_000;
const TO_GMS_PER_WINDOW = 12;

export async function sendToGms(content, clientNonce) {
  const me = await account();
  if (me.error) return { ok: false, error: me.error };
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return { ok: false, error: "Write something first." };
  if (text.length > PLAYER_DM_MAX_LENGTH) {
    return { ok: false, error: `That is too long — ${PLAYER_DM_MAX_LENGTH} characters at most.` };
  }
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } });
  if (config && !config.playPanelEnabled) return { ok: false, error: "The Chat page is switched off." };
  const recent = await prisma.directMessage.count({
    where: {
      discordUserId: me.discordUserId,
      direction: "INBOUND",
      createdAt: { gte: new Date(Date.now() - TO_GMS_WINDOW_MS) },
    },
  });
  if (recent >= TO_GMS_PER_WINDOW) return { ok: false, error: "Slow down a moment." };

  // The composer's own id for this line. It is what retires the pending row
  // in DmPane, and a re-send under the same nonce can only find the row that
  // is already here — the same treatment the GM's side of the conversation
  // gets (PLAYER-DESK.md §5).
  const nonce = clientNonce ? String(clientNonce).trim().slice(0, 64) : null;
  if (nonce) {
    const already = await prisma.directMessage.findFirst({
      // A nonce is a posted value, not proof of who posted it — scope the
      // lookup to this player's own inbound row so a guessed/replayed nonce
      // can never hand back somebody else's DirectMessage (CLAUDE.md: never
      // trust a posted id).
      where: { clientNonce: nonce, discordUserId: me.discordUserId, direction: "INBOUND" },
      select: PLAYER_DM_SELECT,
    });
    if (already) return { ok: true, row: playerDmRow(already) };
  }

  const row = await prisma.directMessage.create({
    data: {
      discordUserId: me.discordUserId,
      direction: "INBOUND",
      content: text,
      source: "player",
      clientNonce: nonce,
      meta: { via: "play" },
    },
    select: PLAYER_DM_SELECT,
  });
  return { ok: true, row: playerDmRow(row) };
}

// The Desire picker's catalog, ~271 templates evaluated against this
// character's gates. Fetched the first time the picker opens rather than on
// every page load — the slot half the column draws costs one query and comes
// down with the page (web/lib/selfPools.js).
export async function desireCatalogView() {
  const me = await actor({
    id: true,
    tags: { select: { tagId: true, tag: true } },
    role: { select: { slug: true } },
  });
  if (me.error) return { ok: false, error: me.error };
  const [openTurn, gameConfig] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { desireSlots: true, desireSlotLockTurns: true },
    }),
  ]);
  return { ok: true, view: await loadDesireView(me.character, { openTurn, gameConfig }) };
}

// ------------------------------------------------------------ waiting on you

// Everything that is holding still until this player answers it: a lesson,
// a binding or a confession somebody offered; a threat seat; a letter the
// bird is still waiting on; a lobby assignment. Each row's Accept/Decline
// calls the SAME db/lib function the DM's buttons call, so an answer given
// here and an answer given in Discord are the same answer.
export async function waitingOnYou() {
  const me = await actor({ id: true, name: true, discordUserId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });

  const [offers, spawns, letters, lobbyEntry] = await Promise.all([
    openTurn
      ? prisma.offer.findMany({
          // Only what is MINE to answer. An offer I made is waiting on
          // somebody else, and listing it here would be a to-do I cannot do.
          where: { turnId: openTurn.id, status: "PENDING", responderId: me.character.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, kind: true, initiatorId: true, tag: { select: { name: true } } },
        })
      : [],
    prisma.threatSpawn.findMany({
      where: { discordUserId: me.discordUserId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, threatSlug: true },
    }),
    prisma.birdMessage.findMany({
      where: { recipientId: me.character.id, delivered: true, repliedAt: null, replyDeadlineTurn: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, senderName: true, replyDeadlineTurn: true },
    }),
    prisma.lobbyEntry.findFirst({
      where: { discordUserId: me.discordUserId, status: "ASSIGNED" },
      select: { id: true, assignedRoleId: true },
    }),
  ]);

  const initiators = offers.length
    ? await prisma.character.findMany({
        where: { id: { in: offers.map((o) => o.initiatorId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(initiators.map((c) => [c.id, c.name]));

  const rows = [
    ...offers.map((o) => ({
      key: `offer:${o.id}`,
      id: o.id,
      kind: "offer",
      // A chaplain waiting on a confession is never told what it is about,
      // here or anywhere else.
      label:
        o.kind === "CONFESSION"
          ? `${nameOf.get(o.initiatorId) ?? "Somebody"} asks you to hear their confession.`
          : o.kind === "BIND"
            ? `${nameOf.get(o.initiatorId) ?? "Somebody"} asks to bind you.`
            : `${nameOf.get(o.initiatorId) ?? "Somebody"} offers ${o.tag?.name ?? "a lesson"}.`,
      decline: true,
    })),
    ...spawns.map((s) => ({
      key: `spawn:${s.id}`,
      id: s.id,
      kind: "spawn",
      label: "A seat is open to you.",
      decline: true,
    })),
    ...letters.map((l) => ({
      key: `bird:${l.id}`,
      id: l.id,
      kind: "bird",
      // No Accept here: answering a letter means choosing which paper goes
      // back, which is the Bird dialog on the sheet. This row is the
      // reminder that the bird has not left yet.
      label: `The bird still waits on an answer to ${l.senderName}.`,
      accept: false,
      decline: false,
      href: "/character",
    })),
    ...(lobbyEntry
      ? [
          {
            key: `lobby:${lobbyEntry.id}`,
            id: lobbyEntry.id,
            kind: "lobby",
            label: "You have a seat waiting to be taken up.",
            accept: false,
            decline: true,
            href: "/character",
          },
        ]
      : []),
  ];

  return { ok: true, rows };
}

export async function answerWaiting({ kind, id, accept } = {}) {
  const me = await actor({ id: true, name: true, discordUserId: true, status: true });
  if (me.error) return { ok: false, error: me.error };

  if (kind === "offer") {
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) return { ok: false, error: "That offer's gone." };
    // Matched to the OFFER's responder, never to a posted id.
    if (offer.responderId !== me.character.id) return { ok: false, error: "That's not yours to answer." };
    const responder = { id: me.character.id, name: me.character.name, discordUserId: me.discordUserId };

    const result = accept
      ? offer.kind === "BIND"
        ? await acceptBind(prisma, offer, responder)
        : offer.kind === "CONFESSION"
          ? await acceptConfession(prisma, offer, responder)
          : await acceptLesson(prisma, offer, responder)
      : await declineOffer(prisma, offer, responder);
    if (!result.ok) return { ok: false, error: result.reason };

    // The same post-commit sync the DM handler runs: a fresh Bound tag
    // changes what rooms the target may stand in, and what they can carry.
    if (result.boundId) {
      try {
        const drop = await settleCarry(prisma, result.boundId);
        const row = await prisma.character.findUnique({ where: { id: result.boundId } });
        if (row) await syncCharacterRoomAccess(prisma, row).catch(() => {});
        if (drop) await deliverCarryDrop(prisma, drop).catch(() => {});
      } catch {
        // The bind stands either way; a failed sync is the doctor's problem.
      }
    }
    for (const dm of result.dms ?? []) {
      await sendDm(dm.discordUserId, dm.content).catch(() => {});
    }
    return { ok: true, line: result.line };
  }

  if (kind === "spawn") {
    const result = accept
      ? await acceptThreatSpawn(prisma, id, me.discordUserId)
      : await declineThreatSpawn(prisma, id, me.discordUserId);
    if (!result.ok) return { ok: false, error: result.reason };
    if (accept) {
      await applySpawnSideEffects(prisma, result.sideEffects).catch(() => {});
    }
    return { ok: true, line: result.line };
  }

  if (kind === "lobby") {
    const result = await declineAssignment(prisma, id, me.discordUserId);
    return result.ok ? { ok: true, line: result.line } : { ok: false, error: result.reason };
  }

  return { ok: false, error: "There's nothing to answer there." };
}

// ------------------------------------------------------------ slash commands
//
// The web twins of the player slash commands (bot/src/lib/commands.js). Each
// one is the SAME rule the Discord handler runs, extracted into db/lib so the
// two faces cannot drift: db/lib/conceal.js, db/lib/shout.js, db/lib/roll.js.
// What is left here is the sequencing the web needs — resolve the actor from
// the session, re-check the place, write the scene row beside the Discord
// post — and nothing else.
//
// `/move`, `/travel`, `/converse` and `/look` need no new action: they are
// submitMove, travelTo, openConversation and the sheet's Examine dialog, all
// of which already exist above.

// /conceal. A standing state, not a per-message prefix — the alias is what
// the composer wears from here until it is turned off again.
export async function toggleConceal() {
  const me = await actor({
    id: true,
    name: true,
    concealed: true,
    age: true,
    gender: true,
    discordUserId: true,
  });
  if (me.error) return { ok: false, error: me.error };

  const result = await concealRule(prisma, { ...me.character, discordUserId: me.discordUserId });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, concealed: result.concealed, alias: result.alias, line: result.line };
}

// /shout. db/lib/shout.js answers who hears it and what they hear; this does
// both halves of the delivery, because a SYSTEM row is deliberately never
// echoed into a channel by the outbox (db/lib/scene.js) and a shout that only
// reached one face would be a shout half the game did not hear.
//
// Sequential, no Promise.all: this is up to a couple of dozen Locations, and
// a fan-out across all of them would burst Discord's rate-limit buckets. Same
// discipline as the bot's own loop. Every post is caught on its own, so one
// dead channel cannot swallow the rest of the shout.
export async function shoutHere(text, placeKey = null) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };

  // WHERE, then WHETHER, and both before shout() — which claims the five-minute
  // cooldown, so asking afterwards meant a place the player may not shout from
  // cost them five minutes of throat for zero posts.
  //
  // Where: a Room or a Conversation and nowhere else, the same gate Discord
  // uses (db/lib/placeKey.js#isScenePlaceKey). The street takes no voice at all
  // and the zone summary is a broadcast rather than a place anybody stands in;
  // `/shout` is offered in neither (commands.js), but a server action is a
  // public endpoint and the UI is a hint rather than a lock. This used to
  // refuse the street alone, so a summary place key fell through and shouted
  // from wherever the character actually stood.
  //
  // Whether: from inside a soundproof room the thread is the ONLY audience, so
  // a write the player does not have would burn the cooldown on a shout
  // literally nobody heard.
  if (!isScenePlaceKey(placeKey)) {
    return { ok: false, error: "You can only shout in a room or in a conversation." };
  }

  const mine = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!mine) return { ok: false, error: "You can't speak in here." };

  const result = await shout(prisma, { ...me.character, discordUserId: me.discordUserId }, text, { placeKey });
  if (!result.ok) {
    return { ok: false, error: result.error, retryAfter: result.retryAfter ?? null };
  }

  // Everything from here down is DELIVERY, and db/lib/shout.js#deliverShout
  // is all of it — the room you stand in first, then the street and its
  // neighbours. Three callers used to carry this loop character-for-character
  // (here, the bot, and the turn engine's Xom scream) and the one that went
  // stale is why a Discord shout reached nobody on the web.
  //
  // It never throws. The shout has already happened — shout() claimed the
  // cooldown and settled who heard it — so a failed row or a dead channel is
  // one audience short, not a failed shout. That used to leak: only the
  // postMessage calls were guarded, so a sceneLine that failed on the ninth of
  // twenty-nine places turned an already-committed shout into a rejected
  // promise, which the composer read as "it didn't send" and left the words
  // sitting in the box.
  await deliverShout(prisma, { placeKey, here: result.here, heard: result.heard });

  return { ok: true, line: result.line };
}

// /roll. One d6, in the place that is open — and the place is re-checked
// against the same gate the composer is, because a seq or a place key is a
// string the browser sent.
export async function rollHere(placeKey) {
  const me = await actor({
    id: true,
    name: true,
    age: true,
    gender: true,
    concealed: true,
    locationId: true,
    webOnly: true,
    discordUserId: true,
  });
  if (me.error) return { ok: false, error: me.error };

  // A Room or a Conversation, the same gate /shout takes above: a die is cast
  // in front of the people you are standing with. mayWritePlace alone was not
  // that gate — db/lib/feedAccess.js gives the zone summary `canSpeak: true`,
  // so a summary place key passed it and rolled into the broadcast.
  if (!isScenePlaceKey(placeKey)) {
    return { ok: false, error: "There's nobody here to see it." };
  }

  const may = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!may) return { ok: false, error: "There's nobody here to see it." };

  return castDie(prisma, me.character, placeKey);
}

// /play. db/lib/instrumentPlay.js is the shared implementation the bot's own
// /play now calls too, so a lute plays the same way on both faces — the same
// AuditLog-backed cooldown, the same once-a-turn mood soothe for a Musician.
export async function playHere(placeKey) {
  const me = await actor({
    id: true,
    locationId: true,
    discordUserId: true,
    tags: { select: { tag: { select: { slug: true } }, quantity: true } },
  });
  if (me.error) return { ok: false, error: me.error };

  // A Room or a Conversation, the same gate /shout and /roll take above: an
  // instrument is played in front of the people you are standing with.
  if (!isScenePlaceKey(placeKey)) {
    return { ok: false, error: "There's nobody here to hear it." };
  }

  const may = await mayWritePlace(prisma, me.character, placeKey, {
    gm: false,
    discordUserId: me.discordUserId,
  });
  if (!may) return { ok: false, error: "There's nobody here to hear it." };

  return playInstrument(prisma, { ...me.character, discordUserId: me.discordUserId }, placeKey);
}

// /look, and the eye in the HERE column. One entry point for both kinds of
// person the column knows about: a character id off a named row, or the opaque
// hood token db/lib/whosHere.js mints for a concealed one. A token is 32 hex
// characters and a cuid never is, so the two can be told apart without the
// browser saying which it sent.
//
// Either way it lands on the LINE you last heard them say, not on the person
// standing in front of you. You cannot size up a stranger who has not opened
// their mouth — looking is something you do to somebody you have noticed, and
// what you get back is what you noticed, frozen (db/lib/sightings.js).
const HOOD_TOKEN = /^[0-9a-f]{32}$/;

export async function lookAt(personRef) {
  const ref = String(personRef ?? "").trim();
  if (!ref) return { ok: false, error: "Look at who?" };

  const me = await actor({ id: true, factionId: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };

  // One sightings Map for both halves: resolveHoodToken decides who counts as
  // hooded from the same answer the readout below is built on.
  const seen = await lastSightings(prisma, me.character);
  const targetId = HOOD_TOKEN.test(ref)
    ? await resolveHoodToken(prisma, me.character, ref, { sightings: seen })
    : ref;
  if (!targetId) return { ok: false, error: "They aren't here any more." };

  const sighting = seen.get(targetId);
  if (!sighting) return { ok: false, error: "You haven't heard them say anything." };

  return lookAtRow(sighting.seq);
}

// ------------------------------------------------- who is in this room, and
// ------------------------------------------------- who may let somebody in
//
// The web twin of /add and /remove (bot/src/events/interactionCreate.js).
// They work on two things, and the place decides which:
//
//   - A Conversation. Membership is a PlayerThreadMember row, and it works on
//     any living character wherever they stand — the PlayerThreadInvite row
//     beside it replays the Discord half when they arrive.
//   - A private Room. Membership is a RoomGuest row, and the target has to be
//     STANDING here, because the grant is spent the moment they leave.
//
// A public Room takes neither: everyone standing in the Location can already
// read it, so `members` comes back null and the strip does not draw.

// The conversation behind a `conv:` key, plus whether this character is in
// it. Being a member IS the permission, the same gate the bot applies.
async function conversationHere(character, placeKey, { sightings = null } = {}) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed || parsed.kind !== "conv") return { error: "That isn't a conversation." };
  const conversation = await prisma.playerThread.findUnique({
    where: { id: parsed.id },
    select: { id: true, threadId: true, name: true, locationId: true, location: { select: { name: true } } },
  });
  if (!conversation) return { error: "That conversation is gone." };

  // The raw ids stay HERE, on the server — db/lib/conversations.js is where
  // both faces read them, so the bot and this cannot disagree about who is in
  // a conversation. `members` below is the presented list and carries no id
  // for anybody in a hood (db/lib/presentedMembers.js), which is why the gate
  // is answered off `memberIds` rather than off those rows: your own row is a
  // hood like any other when you are wearing one, and matching on a withheld
  // id would lock you out of your own conversation.
  const memberIds = await conversationMemberIds(prisma, conversation.id);
  if (!memberIds.includes(character.id)) {
    return { error: "You're not in this conversation." };
  }
  const members = await conversationMembers(prisma, conversation.id, character, { sightings });
  return { conversation, members, memberIds };
}

// The private room behind a `room:` key. Two things, not one: your feet at its
// Location, AND a way in — a key or a guest row. The same pair
// db/lib/roomGuests.js#doorwayFor tests, and it has to be both. On Discord the
// second half was implicit, because /add was typed into the room's own thread
// and only an entitled character can see one; without it here, anybody
// standing in the street could hand out a door they cannot open themselves.
async function privateRoomHere(character, placeKey) {
  const parsed = parsePlaceKey(placeKey);
  if (!parsed || parsed.kind !== "room") return { error: "That isn't a room." };
  const room = await prisma.room.findUnique({
    where: { id: parsed.id },
    select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true },
  });
  if (!room) return { error: "That room is gone." };
  if (room.kind !== "PRIVATE") return { error: "Anyone standing here can already walk in." };
  if (character.locationId !== room.locationId) return { error: "You're not in this room." };
  const keys = await roomAccessKeys(prisma, character.id);
  const inside =
    room.accessTagSlugs.some((slug) => keys.heldSlugs.has(slug)) || keys.guestRoomIds.has(room.id);
  if (!inside) return { error: "You are not inside that room." };
  return { room };
}

// Who is in the open place, and who standing here could be let in. One call,
// because the strip draws both and a second round trip for the picker would
// show a list that was already a beat stale.
export async function placeMembers(placeKey) {
  const me = await actor({ id: true, factionId: true, locationId: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  // Not an error: a Location, the zone summary and a public room simply have
  // no guest list, and the strip asks about every place it is shown.
  if (!parsed || (parsed.kind !== "conv" && parsed.kind !== "room")) {
    return { ok: true, members: null, candidates: [] };
  }

  // One sightings Map for the whole answer. It is what decides whether a mask
  // is DRAWN on a member row (PROXYING.md §5a) — standing somewhere is public,
  // what is over your face is not — and the strip and the HERE column above it
  // must agree about it, so they read the same one rather than each asking.
  const sightings = await lastSightings(prisma, me.character);

  let members;
  let memberIds = [];
  let room = null;
  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey, { sightings });
    if (found.error) return { ok: false, error: found.error };
    members = found.members;
    memberIds = found.memberIds;
  } else {
    const found = await privateRoomHere(me.character, placeKey);
    // A public room is not a refusal, it is a place with no strip.
    if (found.error) {
      return found.error.startsWith("Anyone standing here")
        ? { ok: true, members: null, candidates: [] }
        : { ok: false, error: found.error };
    }
    room = found.room;
    memberIds = (
      await prisma.roomGuest.findMany({
        where: { roomId: room.id },
        orderBy: { createdAt: "asc" },
        select: { characterId: true },
      })
    ).map((row) => row.characterId);
    members = await roomGuests(prisma, room.id, me.character, { sightings });
  }

  // Everyone standing here who is not already in — HOODS INCLUDED, because
  // letting somebody through a door does not need their name (PROXYING.md
  // §5). `withHoodIds` is the server-only map this needs to filter them by
  // id; the id is dropped again on the way out.
  const here = await whosHere(prisma, me.character, { sightings, withHoodIds: true });

  // One list, two kinds of row. `id` is private to this function — it is what
  // the two filters below judge on, and what a hood must never be shipped
  // under, since /api/avatar/<id> answers with a face.
  //
  // An untokened hood (no AUTH_SECRET, so hoodToken mints nothing) is absent
  // rather than offered, the same rule Transfer's recipient list applies.
  const inside = new Set(memberIds);
  let candidates = [
    ...(here.named ?? []).map((person) => ({
      id: person.characterId,
      characterId: person.characterId,
      name: person.name,
      avatarVersion: person.avatarVersion,
      avatarPath: person.avatarPath ?? null,
      unknownFace: false,
    })),
    ...(here.concealed ?? [])
      .filter((person) => person.token && here.hoodIds.has(person.token))
      .map((person) => ({
        id: here.hoodIds.get(person.token),
        characterId: null,
        token: person.token,
        name: person.alias,
        avatarVersion: null,
        // The mask if this reader has earned it, the question-mark plate if
        // not — whichever the HERE column decided (PROXYING.md §5a). Not
        // hard-coded to the plate: the picker sits directly under that column,
        // and one hood drawn two ways in one viewport reads as two people.
        avatarPath: person.avatarPath ?? null,
        unknownFace: Boolean(person.unknownFace),
      })),
  ].filter((person) => person.id !== me.character.id && !inside.has(person.id));

  // A key-holder is already in, by their key, and roomGuests() deliberately
  // does not list them (they hold no guest row). Left in the picker they read
  // as somebody outside, and letting one "in" writes a guest row that grants
  // nothing and that /remove then refuses to take back. One query for the
  // whole shortlist — whosHere() carries no tags.
  //
  // NAMED ROWS ONLY, and a hood is deliberately left in the picker even when
  // they hold a key. Dropping them would be a fact about the person the row
  // names — the one thing the metagaming rule forbids a control from leaking
  // (web/app/components/actionRegistry.js) — and here it is the worst
  // possible one: a hood you can see standing there, absent from both the
  // members strip and the picker, is a hood with a key to this room, which is
  // exactly what a hideout's masks are for. The cost of offering them is a
  // guest row that grants what they already had.
  if (room && room.accessTagSlugs.length > 0) {
    const named = candidates.filter((person) => person.characterId);
    if (named.length > 0) {
      const holders = await prisma.characterTag.findMany({
        where: {
          characterId: { in: named.map((person) => person.id) },
          tag: { slug: { in: room.accessTagSlugs } },
        },
        select: { characterId: true },
      });
      const keyed = new Set(holders.map((row) => row.characterId));
      candidates = candidates.filter((person) => !person.characterId || !keyed.has(person.id));
    }
  }

  return { ok: true, members, candidates: candidates.map(({ id: _id, ...person }) => person) };
}

export async function addMember(placeKey, ref) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { ok: false, error: "That place is gone." };

  const raw = String(ref ?? "").trim();
  const characterId = HOOD_TOKEN.test(raw) ? await resolveHoodToken(prisma, me.character, raw) : raw;
  if (!characterId) return { ok: false, error: "They aren't here any more." };

  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey);
    if (found.error) return { ok: false, error: found.error };
    const { conversation } = found;

    const target = await prisma.character.findFirst({
      where: { id: String(characterId ?? ""), status: "ALIVE" },
      select: { id: true, name: true, locationId: true, discordUserId: true, webOnly: true },
    });
    if (!target) return { ok: false, error: "That isn't a living character." };

    // The ROW first, wherever they are standing; the invite row beside it is
    // what replays the DISCORD add when they arrive
    // (db/lib/threadInvites.js). addConversationMember writes the presence
    // notify itself, and only when the row is genuinely new, so a second Add
    // on somebody already in does not wake all of their tabs.
    await addConversationMember(prisma, { playerThreadId: conversation.id, characterId: target.id });
    await prisma.playerThreadInvite
      .upsert({
        where: { threadId_characterId: { threadId: conversation.threadId, characterId: target.id } },
        update: {},
        create: { threadId: conversation.threadId, characterId: target.id },
      })
      .catch((err) => console.error("Failed to record thread invite:", err?.message ?? err));

    // A "web only" target is out of every channel on purpose (CHAT.md §6).
    if (target.locationId === conversation.locationId && !target.webOnly && target.discordUserId) {
      await addThreadMember(conversation.threadId, target.discordUserId).catch(() => {});
    }

    // system_notice, like the bot's twin in interactionCreate.js#notifyLetIn:
    // this is door plumbing, not somebody talking, and without the tag it read
    // as a genuine message on the GM desk.
    await sendDm(
      target.discordUserId,
      `*You were let into ${conversation.location?.name ?? "somewhere"} · ${conversation.name}.*`,
      { kind: DM_KIND.QUIET },
    ).catch(() => {});

    // The presented name in the sentence, not the real one. Adding somebody is
    // the moment the strip redraws, so this was the line that announced who
    // was under the hood you had just invited.
    const shown = await presentedNameOf(prisma, target.id, me.character);
    return {
      ok: true,
      line:
        target.locationId === conversation.locationId
          ? `${shown} was added.`
          : `${shown} is invited — they'll see this when they reach ${conversation.location?.name ?? "this place"}.`,
    };
  }

  const found = await privateRoomHere(me.character, placeKey);
  if (found.error) return { ok: false, error: found.error };

  const result = await addRoomGuest(prisma, {
    actor: me.character,
    roomId: found.room.id,
    characterId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // db/lib/roomGuests.js writes no presence notify of its own — it is the
  // bot's code, and the bot has no places column to update. The added
  // character's Chat has to learn the door opened without a reload.
  await notifyPresence(prisma, result.target.id).catch(() => {});
  await sendDm(
    result.notify.discordUserId,
    `*You were let into ${result.notify.placeName ?? "somewhere"} · ${result.notify.threadName}.*`,
    { kind: DM_KIND.QUIET },
  ).catch(() => {});

  return { ok: true, line: result.line };
}

// A character id or a hood token, resolved against the roster of the place
// the caller has already gated on. Anything that is not a token is passed
// through as an id and re-checked downstream, which is where a bad id was
// always going to be refused anyway.
function resolveMemberRef(ref, memberIds) {
  const raw = String(ref ?? "").trim();
  if (!HOOD_TOKEN.test(raw)) return raw;
  return resolveMemberToken(memberIds, raw);
}

// `ref` is a character id, or the opaque hood token a concealed member's row
// carries instead of one (db/lib/presentedMembers.js). Same pair /look takes,
// and told apart the same way: a token is 32 hex characters and a cuid never
// is, so the browser never says which it sent.
//
// The token resolves only inside the roster of the place it was minted from,
// which is what makes handing it out safe — it can name somebody in a room you
// are in and nobody anywhere else.
export async function removeMember(placeKey, ref) {
  const me = await actor({ id: true, name: true, locationId: true, discordUserId: true });
  if (me.error) return { ok: false, error: me.error };
  const parsed = parsePlaceKey(placeKey);
  if (!parsed) return { ok: false, error: "That place is gone." };

  if (parsed.kind === "conv") {
    const found = await conversationHere(me.character, placeKey);
    if (found.error) return { ok: false, error: found.error };
    const { conversation, memberIds } = found;
    const characterId = resolveMemberRef(ref, memberIds);

    // ALIVE, the same gate the bot's /remove applies and the same one
    // addMember above already applies: a dead character is off the roster on
    // both faces, and the turn's death pass is what clears their rows.
    const target = await prisma.character.findFirst({
      where: { id: String(characterId ?? ""), status: "ALIVE" },
      select: { id: true, name: true, discordUserId: true },
    });
    if (!target) return { ok: false, error: "That isn't a living character." };

    // The ROW is what membership is (db/lib/conversations.js); the thread
    // member list is its projection, and the invite row would replay the add
    // on their next arrival if it were left behind.
    await removeConversationMember(prisma, { playerThreadId: conversation.id, characterId: target.id });
    await prisma.playerThreadInvite
      .deleteMany({ where: { threadId: conversation.threadId, characterId: target.id } })
      .catch((err) => console.error("Failed to delete thread invite:", err?.message ?? err));
    if (target.discordUserId) {
      await removeThreadMember(conversation.threadId, target.discordUserId).catch((err) =>
        console.error(`Failed to remove ${target.discordUserId} from thread:`, err?.message ?? err),
      );
    }

    // The presented name. Showing somebody out is not the moment to announce
    // who was under the hood.
    const shown = await presentedNameOf(prisma, target.id, me.character);
    return { ok: true, line: `${shown} was removed.` };
  }

  const found = await privateRoomHere(me.character, placeKey);
  if (found.error) return { ok: false, error: found.error };

  const guestIds = (
    await prisma.roomGuest.findMany({ where: { roomId: found.room.id }, select: { characterId: true } })
  ).map((row) => row.characterId);
  const result = await removeRoomGuest(prisma, {
    actor: me.character,
    roomId: found.room.id,
    characterId: resolveMemberRef(ref, guestIds),
  });
  if (!result.ok) return { ok: false, error: result.error };

  await notifyPresence(prisma, result.target.id).catch(() => {});
  return { ok: true, line: result.line };
}
