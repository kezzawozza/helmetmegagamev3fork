// Scene interaction handlers: Who's here?, Examine, Secret rooms, the
// Converse flow (open/room pick/create), and /conceal.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  MENU_OPTION_LIMIT,
  PICK_ID,
  BRING_ID,
  CONFIRM_PREFIX,
  CANCEL_ID,
  loadMover,
  listNames,
  buildLocationSelectRow,
  buildBringRow,
  applyBring,
  freeZoneMovesReason,
  buildConfirmRow,
  freeMovesLeft,
  stowedMounts,
  performMove,
} = require("../../lib/locationTravel");
const {
  syncCharacterRoomAccess,
  accessibleRooms,
  roomAccessKeys,
} = require("@lifeweb/db/lib/roomAccess");
const { resolveActingMember, isGmMember, findAliveCharacter, actingCharacter } = require("../../lib/interactionGuild");
const { toggleConceal } = require("@lifeweb/db/lib/conceal");
const { whosHere, whosHereLines } = require("@lifeweb/db/lib/whosHere");
const { examineLines } = require("@lifeweb/db/lib/examineLocation");
const { openConversationThread } = require("@lifeweb/db/lib/conversationOpen");
const {
  buildConverseModal,
  CONVERSE_MODAL_PREFIX,
  CONVERSE_NAME_FIELD,
} = require("../../lib/converseModal");
const { ack, respond, scheduleDismiss } = require("../../lib/respond");

const CONVERSE_ROOM_PREFIX = "conv:room:";

// The Location anchor's buttons are pressed in the CHANNEL, and a channel is
// open to more people than stand in it now: a character who walked out of this
// street earlier in the turn keeps watching it, read-only, until they leave the
// zone or the day turns (db/lib/vantages.js). Watching is not standing, so
// every button that reads the live state of a place asks first. One sentence
// for the whole rule — the web composer says the same thing.
const NOT_HERE = "You aren't in this location.";

function standingIn(character, locationId) {
  return Boolean(character && character.locationId === locationId);
}

// The green "Who's here?" button. Named characters first — names and nothing
// else, since a role title is private (the same rule the 🔍 inspect embed
// keeps). Concealed characters are listed separately, and a forced name
// outranks a real one without ever joining the concealed line.
async function handleWhosHere(interaction, locationId) {
  await ack(interaction);

  const viewer = await actingCharacter(interaction, {
    select: { id: true, locationId: true },
  });
  // A GM reads the room from anywhere; a player has to be in it. Without this
  // a doorway walked through once would be a live roster of everyone coming
  // and going for the rest of the turn.
  if (!isGmMember(interaction) && !standingIn(viewer, locationId)) {
    await respond(interaction, NOT_HERE);
    return;
  }
  const rows = await whosHere(prisma, viewer, { locationId, withAcross: true });
  const lines = whosHereLines(rows);
  if (lines.length === 0) {
    await respond(interaction, "Nobody is here.");
    return;
  }
  await respond(interaction, `${lines.join("\n")}`);
}


// The Examine button on a Location anchor. Information only — costs nothing,
// can be pressed as often as you like. Answers "what is this place?" in
// three parts: what can be worked here (LIVE labor coefficient as a word,
// db/lib/miningYield.js), what the place IS, and what the ways out are doing
// (db/lib/locationAttributes.js). Readable by anyone standing here — scouting
// is the point.
async function handleExamine(interaction, locationId) {
  await ack(interaction);

  if (!isGmMember(interaction)) {
    const viewer = await findAliveCharacter(interaction.user.id);
    if (!standingIn(viewer, locationId)) {
      await respond(interaction, NOT_HERE);
      return;
    }
  }

  const result = await examineLines(prisma, locationId); // shared with Chat's Examine dialog
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }
  const lines = [`» *${result.name}.*`, ...result.lines];
  await respond(interaction, lines.join("\n"));
}


// "Secret rooms?": doors this character can open here that nobody else can
// see they can — Private Rooms from key tags (db/lib/roomAccess.js),
// Conversations from having opened or been invited to one.
async function handleSecretRooms(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  if (!standingIn(character, locationId)) {
    await respond(interaction, NOT_HERE);
    return;
  }

  const [rooms, keys, invites] = await Promise.all([
    prisma.room.findMany({
      where: { locationId, kind: "PRIVATE", discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true, discordThreadId: true },
      orderBy: { sortOrder: "asc" },
    }),
    roomAccessKeys(prisma, character.id),
    prisma.playerThreadInvite.findMany({
      where: { characterId: character.id },
      select: { threadId: true },
    }),
  ]);

  const mine = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  const conversations = await prisma.playerThread.findMany({
    where: {
      locationId,
      OR: [
        { creatorCharacterId: character.id },
        { threadId: { in: invites.map((i) => i.threadId) } },
      ],
    },
    select: { threadId: true },
    orderBy: { createdAt: "asc" },
  });

  const lines = [];
  if (mine.length > 0) {
    lines.push(`**Private Rooms:** ${mine.map((r) => `<#${r.discordThreadId}>`).join(" | ")}`);
  }
  if (conversations.length > 0) {
    lines.push(`**Conversations:** ${conversations.map((c) => `<#${c.threadId}>`).join(" | ")}`);
  }
  if (lines.length === 0) {
    await respond(interaction, "No secret rooms here.");
    return;
  }
  await respond(interaction, `${lines.join("\n")}`);
}


// "Converse": the only thread a player can still open, linked to a Room so
// it hears somebody whispering every 15 minutes (bot/src/lib/whisperPoll.js).
async function handleConverseOpen(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  if (!standingIn(character, locationId)) {
    await respond(interaction, NOT_HERE);
    return;
  }

  const [rooms, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId, discordThreadId: { not: null } },
      select: { id: true, name: true, kind: true, accessTagSlugs: true },
      orderBy: { sortOrder: "asc" },
    }),
    roomAccessKeys(prisma, character.id),
  ]);
  const options = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).slice(0, MENU_OPTION_LIMIT);
  if (options.length === 0) {
    await respond(interaction, "There's no room here to hold a conversation in.");
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${CONVERSE_ROOM_PREFIX}${locationId}`)
    .setPlaceholder("Where?")
    .addOptions(
      options.map((room) => ({
        label: room.name.slice(0, 100),
        value: room.id,
        ...(room.kind === "PRIVATE" ? { description: "Private" } : {}),
      })),
    );

  await respond(interaction, {
    content: "Where?\n-# Speak privately with someone.",
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}


async function handleConverseRoomPick(interaction) { // modal must show within 3s, nothing awaited here
  await interaction.showModal(buildConverseModal(interaction.values[0]));
}


async function handleConverseCreate(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { location: true },
  });
  if (!room) {
    await respond(interaction, "That room no longer exists.");
    return;
  }
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not in ${room.location.name} any more.`);
    return;
  }
  if (!room.location.discordChannelId) {
    await respond(interaction, "That place has no channel yet — tell a GM.");
    return;
  }

  const name = interaction.fields.getTextInputValue(CONVERSE_NAME_FIELD).trim().slice(0, 90);
  if (!name) {
    await respond(interaction, "Give it a name.");
    return;
  }

  const opened = await openConversationThread(prisma, { // shared with Chat's Converse dialog and Xom's turn pass
    locationId: room.locationId,
    roomId: room.id,
    name,
    characterIds: [character.id],
    creatorCharacterId: character.id,
  });
  if (!opened.ok) {
    await respond(interaction, opened.error);
    return;
  }
  const thread = { id: opened.threadId };
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId,
        actionType: "conversation_opened",
        targetCharacterId: character.id,
        details: { threadId: thread.id, name, room: room.name, location: room.location.name },
      },
    })
    .catch((err) => console.error("Conversation audit log failed:", err));

  await respond(interaction, `» *Opened.*\n<#${thread.id}>`, { fleeting: true });
}


// /conceal: a standing state, not a per-message prefix. db/lib/conceal.js
// #toggleConceal is the rule (shared with the web); this handler is only the
// Discord end. findAliveCharacter, not actingCharacter, deliberately:
// /conceal is registered ANYWHERE and must work in a DM with no guild/member.
async function handleConcealCommand(interaction) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  const result = await toggleConceal(prisma, character);
  await respond(interaction, result.ok ? result.line : result.error);
}


module.exports = {
  CONVERSE_ROOM_PREFIX,
  handleWhosHere,
  handleExamine,
  handleSecretRooms,
  handleConverseOpen,
  handleConverseRoomPick,
  handleConverseCreate,
  handleConcealCommand,
};
