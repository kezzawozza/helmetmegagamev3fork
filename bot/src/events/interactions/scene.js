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
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../../lib/interactionGuild");
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

// The conversation-room select, the one custom id in this flow that isn't
// defined next to the component that carries it (the modal's lives in
// bot/src/lib/converseModal.js, the anchor buttons' in
// db/lib/locationAnchorRow.js, the travel flow's in
// bot/src/lib/locationTravel.js).
const CONVERSE_ROOM_PREFIX = "conv:room:";

// The green "Who's here?" button on a Location's anchor. Named characters
// first, with their Role for a fellow member of a real faction — the same
// rule the 🔍 inspect gate uses, because Role is same-faction knowledge and
// not Silo authority (FACTIONS.md §4a). Concealed characters are listed
// separately and only as what a stranger could tell at a glance. A forced
// name (Tag.forcedName) outranks both: it goes in the Here: list with no
// Role — a Role is as identifying as a name — and never in the concealed
// line even if Character.concealed is still on underneath.
async function handleWhosHere(interaction, locationId) {
  await ack(interaction);

  const viewer = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    select: { id: true, factionId: true },
  });
  const rows = await whosHere(prisma, viewer, { locationId, withAcross: true });
  const lines = whosHereLines(rows);
  if (lines.length === 0) {
    await respond(interaction, "Nobody is here.");
    return;
  }
  await respond(interaction, `${lines.join("\n")}`);
}


// "Secret rooms?": the doors this character can open here that nobody else
// can see they can. Private Rooms come from the key tags they hold
// (db/lib/roomAccess.js); Conversations come from having opened one or been
// invited to it.
// The Examine button on a Location anchor. Information only — it files
// nothing, costs nothing and can be pressed as often as you like.
//
// It answers one question, "what is this place?", in three parts: what can be
// worked here, what the place IS, and what the ways out are doing. The labor
// half is the old Labor? button unchanged — the LIVE coefficient
// (LocationYield.current) as a word rather than a number, because working out
// that Bountiful beats Ample is the player's job and the numbers move anyway
// (db/lib/laborYield.js). The rest comes from db/lib/locationAttributes.js.
//
// Deliberately readable by anyone standing here, whether or not they hold a
// Laboring tag — scouting a place is the point, and a scout reporting back to
// a hunter is a conversation the game wants.
async function handleExamine(interaction, locationId) {
  await ack(interaction);

  // db/lib/examineLocation.js is the one composer — Chat's Examine dialog
  // reads from the same function, so the two surfaces cannot drift apart.
  const result = await examineLines(prisma, locationId);
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }
  const lines = [`» *${result.name}.*`, ...result.lines];
  await respond(interaction, lines.join("\n"));
}


async function handleSecretRooms(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
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


// "Converse": the only thread a player can still open. It is linked to a
// Room, and every 15 minutes that Room hears somebody is whispering
// (bot/src/lib/whisperPoll.js) — which is what keeps a private thread from
// being a place nobody can tell is happening.
async function handleConverseOpen(interaction, locationId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  if (character.locationId !== locationId) {
    await respond(interaction, "You're not there any more.");
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


// A modal must be shown within 3 seconds and cannot be deferred first, so
// nothing is awaited here — every gate runs on submit.
async function handleConverseRoomPick(interaction) {
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

  // The one copy of the open sequence, shared with Chat's Converse dialog and
  // with Xom's turn pass — see db/lib/conversationOpen.js.
  const opened = await openConversationThread(prisma, {
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


// /conceal: a standing state, not a per-message prefix. While it is on, every
// message proxies under the alias with the unknown silhouette, and Who's here
// lists the alias instead of the name. db/lib/conceal.js#toggleConceal is the
// rule — the same one the web's Chat composer asks — and this handler is only
// the Discord end of it.
//
// findAliveCharacter rather than actingCharacter, deliberately: /conceal is
// registered ANYWHERE (bot/src/lib/commands.js), so it has to work in a DM,
// where there is no guild and no member to resolve. It touches none of
// interaction.guild, .member or .channel, and it should stay that way.
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
