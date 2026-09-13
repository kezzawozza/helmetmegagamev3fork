const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { setVisibleZones } = require("@lifeweb/db/lib/gmZoneView");
const { syncGmZoneRoles } = require("@lifeweb/db/lib/gmZoneRoles");
const { isUnaffiliated } = require("@lifeweb/db/lib/factionConstants");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  loadConcealment,
  loadForcedName,
  presentedIdentity,
} = require("@lifeweb/db/lib/presentedIdentity");
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
} = require("../lib/locationTravel");
const {
  travelOptions,
  gateOperable,
  isHeldOpen,
  KEYED_OPEN_MS,
} = require("@lifeweb/db/lib/locationGraph");
const { heldReasonFor, INTERCEPT_RELEASE_PREFIX } = require("@lifeweb/db/lib/intercept");
const { ATTACK_CANCEL_PREFIX } = require("@lifeweb/db/lib/attack");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { reconcileNarrowcastAccess } = require("@lifeweb/db/lib/locationMove");
const {
  syncCharacterRoomAccess,
  accessibleRooms,
  roomAccessKeys,
} = require("@lifeweb/db/lib/roomAccess");
const {
  addConversationMember,
  removeConversationMember,
  isConversationMember,
} = require("@lifeweb/db/lib/conversations");
const { settleCarry, deliverCarryDrop } = require("@lifeweb/db/lib/carry");
const { sendDm } = require("../lib/dm");
const { escortCandidates, partyOf } = require("@lifeweb/db/lib/escort");
const { buildMoveModal } = require("../lib/moveModal");
const { confirmMove } = require("../lib/moveConfirm");
const { buildSpeakModal } = require("../lib/speakModal");
const { canSpeakInTarget } = require("../lib/speakTargets");
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../lib/interactionGuild");
const { presentedNameOf } = require("@lifeweb/db/lib/presentedMembers");
const { placeKeyForChannel, isScenePlaceKey } = require("@lifeweb/db/lib/placeKey");
const { playInstrument } = require("@lifeweb/db/lib/instrumentPlay");
const { postAsCharacterTo, loadVoiceState } = require("../lib/proxy");
const { prepareSpeech, recordSpeech } = require("@lifeweb/db/lib/say");
const { resolveLaborRate } = require("@lifeweb/db");
const { touchCharacterActivity } = require("@lifeweb/db/lib/characterActivity");
const { dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { HEALTH_CATEGORY } = require("@lifeweb/db/lib/medicalVision");
const { moveWindow, epochSeconds } = require("@lifeweb/db/lib/turnClock");
const { castDie } = require("@lifeweb/db/lib/roll");
const { toggleConceal } = require("@lifeweb/db/lib/conceal");
const { addRoomGuest, removeRoomGuest } = require("@lifeweb/db/lib/roomGuests");
const { notifyPresence } = require("@lifeweb/db/lib/presenceNotify");
const { messageLink } = require("../lib/mentions");
const { addThreadMember } = require("@lifeweb/db/lib/discordRest");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");
const {
  WHOS_HERE_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
} = require("@lifeweb/db/lib/locationAnchorRow");
const { refreshLocationAnchor, refreshGateRooms } = require("@lifeweb/db/lib/syncZones");
// Phase 3 moved the game logic these four handlers used to hold down into
// db/lib, so Chat's dialogs and these buttons run one implementation.
// What is left up here is Discord: acknowledge, call, say the sentence back,
// and — for a gate — redraw the anchor and the watchtower, which is a
// Discord-only follow-up nothing in db/ could do.
const { GATE_CHARACTER_SELECT, toggleGate, holdKeyedOpen } = require("@lifeweb/db/lib/gates");
const { fileMove } = require("@lifeweb/db/lib/moves");
const { whosHere, whosHereLines } = require("@lifeweb/db/lib/whosHere");
const { examineLines } = require("@lifeweb/db/lib/examineLocation");
const { blockerFor, ACT } = require("@lifeweb/db/lib/incapacitation");
const {
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
} = require("@lifeweb/db/lib/roomStarterRow");
const { INTERCOM_ROOM_SLUG, broadcastIntercom } = require("@lifeweb/db/lib/intercom");
const { INTERCOM_MODAL_PREFIX, buildIntercomModal } = require("../lib/intercomModal");
const { buildQuestModal } = require("../lib/questModal");
const {
  QUEST_INTERACT_PREFIX,
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  questInteract,
} = require("@lifeweb/db/lib/quests");
const {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  buildTurretModal,
  turretWordMatches,
} = require("../lib/turretModal");
const { BELL_ROOM_SLUG, bellCooldown, broadcastBell } = require("@lifeweb/db/lib/bell");
const { XOM_SHRINE_ROOM_SLUG, grantXom } = require("@lifeweb/db/lib/xom");
const { openConversationThread } = require("@lifeweb/db/lib/conversationOpen");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");
const {
  BELL_MODAL_PREFIX,
  BELL_WORD_FIELD,
  buildBellModal,
  bellWordMatches,
} = require("../lib/bellModal");
const {
  GATEHOUSE_LOCATION_SLUG,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
  gatehouseTurretArmed,
} = require("@lifeweb/db/lib/gatehouseTurret");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { shout, deliverShout } = require("@lifeweb/db/lib/shout");
const { clockFrozen } = require("@lifeweb/db/lib/gameState");
const { LOBBY_DECLINE_PREFIX } = require("@lifeweb/db/lib/lobby");
const { handleLobbyDecline } = require("../lib/lobby");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { handleRoomStorage } = require("../lib/roomStorage");
const {
  buildConverseModal,
  CONVERSE_MODAL_PREFIX,
  CONVERSE_NAME_FIELD,
} = require("../lib/converseModal");
const { resolveChannelContext } = require("../lib/channels");
const { ack, respond, scheduleDismiss } = require("../lib/respond");
const { handleReportOpen, handleReportClose } = require("../lib/reportChannel");
const { BIRD_REPLY_PREFIX, BIRD_REPLY_PICK_PREFIX } = require("@lifeweb/db/lib/bird");
const { handleBirdReplyOpen, handleBirdReplyPick } = require("../lib/birdReply");
const { NOTICEBOARD_PREFIX } = require("@lifeweb/db/lib/locationAnchorRow");
const {
  READ_PREFIX: NOTICE_READ_PREFIX,
  TEAR_PREFIX: NOTICE_TEAR_PREFIX,
  PIN_PREFIX: NOTICE_PIN_PREFIX,
  POST_PREFIX: NOTICE_POST_PREFIX,
  POST_MODAL_PREFIX: NOTICE_POST_MODAL_PREFIX,
  handleNoticeboardOpen,
  handleNoticeRead,
  handleNoticeTear,
  handleNoticePin,
  handleNoticePost,
  handleNoticePostSubmit,
} = require("../lib/noticeboardPanel");
const { OFFER_ACCEPT_PREFIX, OFFER_DECLINE_PREFIX } = require("@lifeweb/db/lib/offerRow");
const { handleOfferAccept, handleOfferDecline } = require("../lib/offers");
const { PENDING_TAX_DECLINE_PREFIX } = require("@lifeweb/db/lib/tax");
const { handleTaxDecline } = require("../lib/tax");
const {
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
} = require("@lifeweb/db/lib/threats");
const { handleThreatSpawnAccept, handleThreatSpawnDecline } = require("../lib/threatSpawn");
const {
  OPEN_PREFIX: EDIT_OPEN_PREFIX,
  MODAL_PREFIX: EDIT_MODAL_PREFIX,
  handleEditOpen,
  handleEditSubmit,
} = require("../lib/editModal");
const { OPEN_BUTTON_ID: REPORT_OPEN_ID, CLOSE_BUTTON_ID: REPORT_CLOSE_ID } = require("@lifeweb/db/lib/reportChannelAccess");

// The conversation-room select, the one custom id in this flow that isn't
// defined next to the component that carries it (the modal's lives in
// bot/src/lib/converseModal.js, the anchor buttons' in
// db/lib/locationAnchorRow.js, the travel flow's in
// bot/src/lib/locationTravel.js).
const CONVERSE_ROOM_PREFIX = "conv:room:";

const ZONE_VIEW_ID = "zoneview:pick";

// /zone — the Discord twin of the Zones control at the bottom of the GM
// desks' inspector. Both write the same GmZoneView rows and both call
// syncGmZoneRoles, so a GM can toggle from wherever they happen to be.
//
// Nothing selected means EVERY zone, which is why the menu's min_values is 0:
// clearing it is a real answer, not an empty form.
async function handleZoneCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "GMs only.");
    return;
  }
  await ack(interaction);

  const [zones, current] = await Promise.all([
    // Only zones with a seat to hand out — see web/lib/gmZoneView.js.
    prisma.zone.findMany({
      where: { gmRoleId: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.gmZoneView.findMany({
      where: { discordUserId: interaction.user.id },
      select: { zoneId: true },
    }),
  ]);
  if (zones.length === 0) {
    await respond(interaction, "There aren't any zones yet.");
    return;
  }
  const chosen = new Set(current.map((r) => r.zoneId));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(ZONE_VIEW_ID)
    .setPlaceholder("Which zones do you want to see?")
    .setMinValues(0)
    .setMaxValues(zones.length)
    .addOptions(
      zones.map((zone) => ({
        label: zone.name.slice(0, 100),
        value: zone.id,
        default: chosen.has(zone.id),
      })),
    );

  await respond(interaction, {
    content:
      "Which zones do you want to see?\n" +
      "-# This sets your Discord channels and your desks.",
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handleZoneViewPick(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "GMs only.");
    return;
  }
  await ack(interaction);

  const wanted = interaction.values ?? [];
  await setVisibleZones(prisma, interaction.user.id, wanted);
  // Outside the write and best-effort, the same posture every Discord fan-out
  // in the app takes — a rate limit should not cost the GM their choice.
  await syncGmZoneRoles(prisma, interaction.user.id).catch((err) =>
    console.error("/zone: role sync failed:", err.message ?? err),
  );

  if (wanted.length === 0) {
    await respond(interaction, "You can see every zone.");
    return;
  }
  const zones = await prisma.zone.findMany({
    where: { id: { in: wanted } },
    orderBy: { sortOrder: "asc" },
    select: { name: true },
  });
  await respond(interaction, `You can see ${zones.map((z) => z.name).join(", ")}.`);
}

async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "GMs only.");
    return;
  }
  await ack(interaction);

  const content = interaction.options.getString("message", true);
  const attachment = interaction.options.getAttachment("attachment");

  try {
    await interaction.channel.send({ content, files: attachment ? [attachment.url] : [] });
  } catch (err) {
    console.error("Failed to send /gm message:", err);
    await respond(interaction, "That didn't send. Check the bot can post here, and try again.");
    return;
  }

  // Speaking as the game into a room is a GM act, and this was the one send
  // path that left no trace of who made it — the message wears the bot's
  // name, so without this line /gm/audit cannot answer "who said that".
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "gm_channel_message",
        details: { channelId: interaction.channelId, message: content, attachment: attachment?.url ?? null },
      },
    })
    .catch((err) => console.error("Failed to log /gm message:", err));

  await respond(interaction, "Sent.", { fleeting: true });
}

// /dm: DM a chosen server member as the bot itself, logged via
// bot/src/lib/dm.js#sendDm like every other bot-sent DM.
async function handleGmDmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "GMs only.");
    return;
  }
  await ack(interaction);

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`, {
      authorDiscordUserId: interaction.user.id,
      source: "gm_slash",
      kind: DM_KIND.CONVERSATION,
    });
    // Same reason /gm writes one: a GM message that reached a player with no
    // record of who sent it is the gap /gm/audit exists to close. The DM row
    // itself already carries the author, but the log is the place a GM looks.
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: interaction.user.id,
          actionType: "gm_dm_sent",
          details: { discordUserId: recipient.id, message: content },
        },
      })
      .catch((err) => console.error("Failed to log /dm:", err));
    await respond(interaction, `Sent to ${recipient}.`, { fleeting: true });
  } catch (err) {
    console.error("Failed to send /dm DM:", err);
    // 50007 is the real closed-DMs code; an over-length message fails the
    // same way and must not be misreported as closed DMs.
    const closed = err.code === 50007 || err.status === 403;
    await respond(
      interaction,
      closed
        ? "Couldn't deliver that — they have DMs closed."
        : "Couldn't deliver that. It wasn't their DM settings; check the logs.",
    );
  }
}

// /add and /remove work on two things, and the channel decides which.
//
//   - A Conversation (a PlayerThread row): /add records a PlayerThreadInvite
//     and works on any living character wherever they stand, applied at once
//     if they are already here and replayed by applyPendingInvites on arrival
//     (db/lib/threadInvites.js).
//   - A private Room: /add writes a RoomGuest row, which is the ONE way into
//     a private thread without one of its access tags. The target has to be
//     standing here, because the grant is spent the moment they leave
//     (db/lib/roomAccess.js) — inviting somebody far away would hand them a
//     row that dies before they ever saw the door.
//
// A public Room takes neither: everyone standing in the Location can already
// read it.
async function handleThreadMemberCommand(interaction, action) {
  await ack(interaction);

  const channel = interaction.channel;
  if (!channel) {
    await respond(interaction, "That only works inside a conversation or a private room.");
    return;
  }

  const [row, room] = await Promise.all([
    prisma.playerThread.findUnique({
      where: { threadId: channel.id },
      include: { location: { select: { name: true } } },
    }),
    prisma.room.findFirst({
      where: { discordThreadId: channel.id },
      select: {
        id: true,
        name: true,
        kind: true,
        accessTagSlugs: true,
        locationId: true,
        discordThreadId: true,
        location: { select: { name: true } },
      },
    }),
  ]);

  if (room) {
    await handleRoomGuestCommand(interaction, action, room);
    return;
  }
  if (!row) {
    await respond(interaction, "That only works inside a conversation or a private room.");
    return;
  }

  // Being a member IS the permission, and membership is the ROWS
  // (db/lib/conversations.js) — not Discord's thread-member list, which this
  // used to fetch. A web-only character is in the rows and in no thread
  // anywhere, so they were shut out of a door they were standing behind.
  const actor = await findAliveCharacter(interaction.user.id);
  const gm = isGmMember(interaction);
  if (!gm) {
    if (!actor) {
      await respond(interaction, "You don't have a living character.");
      return;
    }
    if (!(await isConversationMember(prisma, row.id, actor.id))) {
      await respond(interaction, "You're not in this conversation.");
      return;
    }
  }

  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
  });
  if (!target) {
    await respond(interaction, "That isn't a living character's role.");
    return;
  }

  // What to CALL them in the three sentences below. `target.name` is the real
  // one and these said it out loud, in a channel, about somebody who might be
  // standing there in a hood — so the whole point of the disguise came apart
  // at the door. presentedNameOf is the same resolver the web strip and the
  // HERE column go through (db/lib/presentedMembers.js).
  const shown = await presentedNameOf(prisma, target.id, actor);

  if (action === "remove") {
    // The ROW is what membership is now (db/lib/conversations.js); the thread
    // member list below is its projection.
    await removeConversationMember(prisma, { playerThreadId: row.id, characterId: target.id });
    await prisma.playerThreadInvite
      .deleteMany({ where: { threadId: channel.id, characterId: target.id } })
      .catch((err) => console.error("Failed to delete thread invite:", err));
    // A web-only member holds no thread seat to take away, and the row above
    // is the whole of the removal for them.
    if (target.discordUserId) {
      try {
        await channel.members.remove(target.discordUserId);
      } catch (err) {
        console.error(`Failed to remove ${target.discordUserId} from thread ${channel.id}:`, err);
        await respond(interaction, "Couldn't remove them. The bot may be missing Manage Threads.");
        return;
      }
    }
    await respond(interaction, `${shown} was removed.`, { fleeting: true });
    return;
  }

  // Membership first, wherever they are standing. The invite row beside it is
  // still what replays the DISCORD add when they arrive (db/lib/threadInvites.js)
  // — but the web feed shows them the conversation the moment they are in it,
  // which is what makes /add work for a player who never sees the thread.
  await addConversationMember(prisma, { playerThreadId: row.id, characterId: target.id });
  await prisma.playerThreadInvite
    .upsert({
      where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
      update: {},
      create: { threadId: channel.id, characterId: target.id },
    })
    .catch((err) => console.error("Failed to record thread invite:", err));

  // A "web only" target is out of every channel on purpose (CHAT.md §6), so
  // the row above is the whole of the add: they see the conversation on /chat
  // and the invite row replays the Discord half if they ever come back off it.
  if (target.locationId === row.locationId && !target.webOnly && target.discordUserId) {
    try {
      await addThreadMember(channel.id, target.discordUserId);
    } catch (err) {
      console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err);
    }
    await notifyLetIn(interaction, target, row.name, row.location?.name, channel.id);
    await respond(interaction, `${shown} was added.`, { fleeting: true });
    return;
  }
  await respond(
    interaction,
    `${shown} is invited — they'll see this when they reach ${row.location?.name ?? "this place"}.`,
    { fleeting: true },
  );
}

// Telling somebody a door opened for them. Discord's own "you were added to a
// thread" notice is easy to miss and says nothing about where, so this carries
// the place and a link — never the content, the same rule notifyMentioned
// keeps (bot/src/lib/mentions.js).
async function notifyLetIn(interaction, target, threadName, placeName, threadId) {
  if (!target.discordUserId) return;
  const where = placeName ? `${placeName} · ${threadName}` : threadName;
  const user = await interaction.client.users.fetch(target.discordUserId).catch(() => null);
  if (!user) return;
  const link = `https://discord.com/channels/${interaction.guildId}/${threadId}`;
  await sendDm(user, `» *You were let into ${where}.*\n${link}`, { kind: DM_KIND.QUIET }).catch(() => { });
}

// The Room half of /add and /remove. db/lib/roomGuests.js is the rule — the
// same one the web's member strip asks — and this is only the Discord end of
// it: resolve the target from the role picker, then hand the id down.
//
// The role, rather than a user, is the whole reason /add takes one: the picker
// then names characters and never Discord accounts, so inviting somebody
// cannot reveal who plays them (bot/src/lib/commands.js).
async function handleRoomGuestCommand(interaction, action, room) {
  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
    select: { id: true },
  });
  if (!target) {
    // Worded for somebody who picked a ROLE, which is what this face offers.
    // db/lib/roomGuests.js says "That isn't a living character." to a caller
    // that picked a person.
    await respond(interaction, "That isn't a living character's role.");
    return;
  }

  const actor = await findAliveCharacter(interaction.user.id);
  const args = { actor, roomId: room.id, characterId: target.id, gm: isGmMember(interaction) };
  const result = action === "remove" ? await removeRoomGuest(prisma, args) : await addRoomGuest(prisma, args);
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }

  // The guest's own Chat has to hear about the door as well — the row changed
  // what places they can read. The web has always done this; the bot never
  // did, so a guest added from Discord sat looking at a page that would not
  // show them the room until they reloaded it.
  await notifyPresence(prisma, result.target.id).catch(() => {});
  if (result.notify) {
    await notifyLetIn(
      interaction,
      result.target,
      result.notify.threadName,
      result.notify.placeName,
      result.notify.threadId,
    );
  }
  await respond(interaction, result.line, { fleeting: true });
}

// The Council Room's Intercom button, and its modal.
//
// showModal IS the acknowledgement and must be the first thing that happens —
// a deferred interaction can no longer open one, and Discord allows three
// seconds. So the button does no database work at all, and every check waits
// for the submit. That is not a hole: an ephemeral modal outlives the player
// walking out of the Keep, so an open-time check would have to be re-run at
// submit anyway.
async function handleIntercomOpen(interaction, roomId) {
  await interaction.showModal(buildIntercomModal(roomId));
}

// A quest's Interact button (docs/systemdocs/QUESTS.md). The only work here is
// reading the quest's title for the modal's heading — everything that decides
// whether the press is allowed waits for the submit, because the modal outlives
// the player walking out of the cave. showModal IS the acknowledgement, so no
// ack() here.
async function handleQuestOpen(interaction, questId) {
  const quest = await prisma.quest.findUnique({
    where: { id: questId },
    select: { title: true, status: true },
  });
  if (!quest || quest.status !== "OPEN") {
    await respond(interaction, "That's over.");
    return;
  }
  await interaction.showModal(buildQuestModal(questId, quest.title));
}

// Every gate lives in db/lib/quests.js#questInteract, which both faces call:
// the quest is still open, they are still standing there, the door is still
// theirs, and they have not already moved. This handler's whole job is to hand
// it the typed intention and say what came back.
async function handleQuestSubmit(interaction, questId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const result = await questInteract(prisma, {
    questId,
    character,
    intention: interaction.fields.getTextInputValue(QUEST_INTENTION_FIELD),
    actorDiscordUserId: interaction.user.id,
  });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }
  await respond(interaction, "Your Gambit is filed. You'll hear how it went when the turn is pushed.");
}

// The big red button in the Censor's Office. Opening the modal is not the act
// — the typed word is — so this only has to find out which way the switch is
// currently thrown. showModal IS the acknowledgement, so no ack() here.
async function handleTurretOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "There's no button here.");
    return;
  }
  await interaction.showModal(buildTurretModal(roomId, await gatehouseTurretArmed(prisma)));
}

// The rope in the Bell Tower. Opening the modal is not the act — the typed
// word is — so nothing is checked here but the room. showModal IS the
// acknowledgement, so no ack().
async function handleBellOpen(interaction, roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { slug: true } });
  if (room?.slug !== BELL_ROOM_SLUG) {
    await respond(interaction, "There's no bell here.");
    return;
  }
  await interaction.showModal(buildBellModal(roomId));
}

// Pray, in the Shrine of an Old Man (docs/zones.yaml, under depths-chasm).
//
// A confirm, not the bell's type-the-word modal, and the difference is
// deliberate. RING is a speed bump on a LOUD act — typing it says "you are
// about to disturb a hundred people". Pressing this disturbs nobody; what it
// does is hand you a permanent tag that can kill you and shut every goal on
// your sheet but one. The right friction for that is being told what the
// bargain is, so the confirm says it.
const PRAY_CONFIRM_PREFIX = "room:pray:go:";

// Alive, standing in the shrine's Location, and admitted through the door.
// Re-run at confirm as well as at open: the ephemeral outlives somebody
// climbing back out of the Chasm, and reaching the shrine is the only
// safeguard on it.
async function prayGate(interaction, roomId) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) return { error: "You don't have a living character." };
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true, accessTagSlugs: true },
  });
  if (!room || room.slug !== XOM_SHRINE_ROOM_SLUG) return { error: "There's no shrine here." };
  if (character.locationId !== room.locationId) {
    return { error: `You're not standing in the ${room.name} any more.` };
  }
  const keys = await roomAccessKeys(prisma, character.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    return { error: "You can't get in there." };
  }
  return { character, room };
}

async function handlePrayOpen(interaction, roomId) {
  await ack(interaction);
  const gate = await prayGate(interaction, roomId);
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  await respond(interaction, {
    content:
      "The face is waiting. Praying here is permanent, it takes whatever you believed in now, " +
      "and what happens to you afterwards is not up to you.",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PRAY_CONFIRM_PREFIX}${roomId}`)
          .setLabel("Pray")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function handlePrayConfirm(interaction, roomId) {
  await ack(interaction);
  const gate = await prayGate(interaction, roomId);
  if (gate.error) {
    await respond(interaction, gate.error);
    return;
  }
  const { character, room } = gate;

  const result = await grantXom(prisma, { characterId: character.id });
  if (result.already) {
    await respond(interaction, "The face is already watching you.");
    return;
  }
  if (result.spoken) {
    await respond(interaction, "Something else has you already, and it does not share.");
    return;
  }
  if (!result.ok) {
    await respond(interaction, "Nothing answers. Tell a GM.");
    return;
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "xom_prayed",
        targetCharacterId: character.id,
        details: { characterName: character.name, room: room.name, replaced: result.replaced },
      },
    })
    .catch((err) => console.error("Pray audit log failed:", err));

  // Anybody else standing in the shrine sees it happen, and nothing leaves the
  // room — the tag is `catalog: secret` and this is the only place it is ever
  // announced at all.
  const witnessed = `${character.name} kneels, and the face seems to lean down.`;
  await sceneLineAt(prisma, { roomId: room.id, text: witnessed }).catch(() => {});
  const thread = await prisma.room
    .findUnique({ where: { id: room.id }, select: { discordThreadId: true } })
    .catch(() => null);
  if (thread?.discordThreadId) {
    await postMessage(thread.discordThreadId, ambientLine(witnessed)).catch(() => {});
  }

  await respond(
    interaction,
    result.replaced
      ? `It takes your ${result.replaced} off you and does not offer anything back.`
      : "Something old and amused turns its attention on you.",
  );
}

async function handleBellSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== BELL_ROOM_SLUG) {
    await respond(interaction, "There's no bell here.");
    return;
  }
  // Decided at submit, never at open: the modal outlives somebody walking back
  // down the tower stairs, and reaching the rope is the only safeguard on it.
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }
  if (!bellWordMatches(interaction.fields.getTextInputValue(BELL_WORD_FIELD))) {
    await respond(interaction, "You leave the rope alone.");
    return;
  }

  // The cooldown is read AFTER the word, so a modal somebody abandoned never
  // reports a wait they were not going to trigger anyway.
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { bellRungAt: true } });
  const { ok, secondsLeft } = bellCooldown(state?.bellRungAt);
  if (!ok) {
    // Minutes, not the raw seconds this used to print: at a half-hour cooldown
    // "1487s" is arithmetic homework rather than an answer.
    const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
    await respond(
      interaction,
      `The bell is on cooldown. About ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    );
    return;
  }

  await prisma.gameState.update({ where: { id: 1 }, data: { bellRungAt: new Date() } });

  const { sent, failed } = await broadcastBell(prisma);

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "bell_rung",
        targetCharacterId: character.id,
        details: { characterName: character.name, sent, failed },
      },
    })
    .catch((err) => console.error("Bell audit log failed:", err));

  await respond(
    interaction,
    failed.length
      ? "The bell sounds."
      : "The bell sounds.",
  );
}

async function handleTurretSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== CENSOR_OFFICE_ROOM_SLUG) {
    await respond(interaction, "There's no button here.");
    return;
  }
  // Decided at submit, never at open: the modal outlives somebody walking out
  // of the Garrison, and reaching the switch is the only safeguard on it.
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }

  // Re-read rather than trusting what the modal was built against — two people
  // in the office can open it at the same moment, and the word they were asked
  // to type is what says which way they meant to throw it.
  const armed = await gatehouseTurretArmed(prisma);
  if (!turretWordMatches(interaction.fields.getTextInputValue(TURRET_WORD_FIELD), armed)) {
    await respond(interaction, "You leave the button alone.");
    return;
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
    await postMessage(gatehouse.discordChannelId, ambientLine(line.text, [], { signed: line.signed })).catch(
      (err) => console.error("Gatehouse turret line failed:", err),
    );
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "gatehouse_turret_toggled",
        details: { armed: next, characterId: character.id, characterName: character.name },
      },
    })
    .catch((err) => console.error("Gatehouse turret audit log failed:", err));

  await respond(
    interaction,
    next
      ? "The button toggles on."
      : "The button toggles off.",
  );
}

async function handleIntercomSubmit(interaction, roomId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, slug: true, locationId: true },
  });
  if (!room || room.slug !== INTERCOM_ROOM_SLUG) {
    await respond(interaction, "There's no intercom here.");
    return;
  }
  if (character.locationId !== room.locationId) {
    await respond(interaction, `You're not standing in the ${room.name} any more.`);
    return;
  }

  const body = interaction.fields.getTextInputValue("intercom:body").trim();
  if (!body) {
    await respond(interaction, "Say something first.");
    return;
  }

  const voice = await loadVoiceState(character.id);
  if (voice.block) {
    await respond(interaction, `You can't get the words out — you're ${voice.block.name}.`);
    return;
  }
  const { sent, failed } = await broadcastIntercom(prisma, body);

  // The transcript is broadcastIntercom's own job since phase 4: it writes one
  // SYSTEM row per zone it reached, so the announcement lands in each zone's
  // feed on /chat as well as in /archive. The single row that used to be
  // written here had no place key and so was invisible in Chat.

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "intercom_broadcast",
        targetCharacterId: character.id,
        details: { body, zonesReached: sent, zonesFailed: failed },
      },
    })
    .catch((err) => console.error("Intercom audit failed:", err.message ?? err));

  // Say what actually happened. A PA that reached four zones out of five is
  // not a failure, but the speaker has to know which one nobody heard. One
  // for the whole message, riding the last line rather than the first.
  const note = failed.length > 0 ? `\n-# Nothing came through in ${failed.join(", ")}.` : "";
  await respond(interaction, `» *Your voice goes out across Ravenheart.*${note}`, { fleeting: true });
}

// Custom IDs below are "loc:"-namespaced for the travel flow off the Travel
// button on the #turns console (bot/src/lib/turnsConsole.js, whose button
// keeps its historical "loc:open" id) and off the three buttons on every
// Location channel's anchor; "conv:" is the Conversation flow; "move:" and
// "say:" are the unrelated Move and Speak modals.

// loc:open, and its /location twin. Offers the Locations connected to where
// the character stands — or, on a first placement, every Location outside the
// caves, because arriving is not travel.
async function handleTravelOpen(interaction) {
  await ack(interaction);

  const character = await loadMover(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  // Somebody has hold of them (docs/systemdocs/INTERCEPT.md). The picker is
  // still worth drawing: travelOptions has marked every row unpassable, which
  // drops them into `shut` below with no work here, so a held player can see
  // where they would have gone.
  const held = heldReasonFor(character);

  let current = null;
  let destinations;
  let shut = [];
  if (!character.locationId) {
    destinations = await prisma.location.findMany({
      where: { zone: { kind: { not: "CAVE_GROUP" } } },
      include: { zone: true },
    });
    destinations.sort(
      (a, b) => (a.zone?.name ?? "").localeCompare(b.zone?.name ?? "") || a.name.localeCompare(b.name),
    );
  } else {
    current = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { zone: true },
    });
    // travelOptions has already dropped the hidden ways this character holds
    // no key to, and sorted the rest. A locked or shut one is still offered:
    // seeing the door and being told what opens it is the point of the locked
    // form, as against the hidden one.
    const rows = await travelOptions(prisma, character, character.locationId);
    destinations = rows.filter((row) => row.passable).map((row) => row.location);
    shut = rows.filter((row) => !row.passable);
  }

  if (destinations.length === 0 && shut.length === 0) {
    await respond(interaction, "Nowhere to go from here.");
    return;
  }

  // Never truncate silently: a missing destination reads as a broken map.
  const truncated = destinations.length - Math.min(destinations.length, MENU_OPTION_LIMIT);
  const shutLine =
    shut.length > 0
      ? `-# Closed to you right now: ${shut.map((row) => row.location.name).join(", ")}.`
      : null;
  await respond(interaction, {
    content: [
      held ? `» *${held}*` : null,
      destinations.length > 0 ? "Where would you like to go?" : "» *Every way out of here is closed to you.*",
      shutLine,
      truncated > 0 ? `-# ${truncated} more not shown — Discord caps this list at 25.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    components: destinations.length > 0 ? [buildLocationSelectRow(destinations, current)] : [],
  });
}

// loc:gate:{linkId} — the Open/Close button on a modular gate's two anchors.
//
// The button is only rendered on the watchtower's starter post, so getting
// into that room is the whole permission model — anyone who can see the
// winch may pull it. `toggleGate` still re-checks that the clicker is
// standing at the gate, because a thread member need not be.
//
// The flip is a conditional updateMany whose WHERE clause carries the state
// the clicker saw, the same shape the move cooldown and the mount claim use.
// Two watchmen clicking "Close" in the same second means one close and one
// "somebody just did", never a double toggle that lands back open.
async function handleGateToggle(interaction, linkId) {
  await ack(interaction);

  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    select: GATE_CHARACTER_SELECT,
  });
  const result = await toggleGate(prisma, {
    character,
    linkId,
    actorDiscordUserId: interaction.user.id,
  });
  if (!result.ok) {
    await respond(interaction, `${result.error}`);
    return;
  }

  // Both sides. The anchor no longer carries the gate at all, but it still
  // lists the ways out, so it is redrawn; the button itself lives on the
  // watchtower's starter, which is what refreshGateRooms redraws. A gate with
  // a tower at only one end has nothing to redraw at the other, and that is
  // fine.
  for (const locationId of result.locationIds) {
    await refreshLocationAnchor(prisma, locationId).catch((err) =>
      console.error(`Gate anchor refresh failed for ${locationId}:`, err.message ?? err),
    );
    await refreshGateRooms(prisma, locationId).catch((err) =>
      console.error(`Gate room refresh failed for ${locationId}:`, err.message ?? err),
    );
  }

  await respond(interaction, `${result.line}`);
}

// loc:keyed:{linkId}:{yes|no} — the answer to "Leave open for the next 24
// hours?" on the DM a keyed crossing raised.
//
// Re-checked rather than trusted: the button was DM'd to a key-holder, but a
// DM is a durable surface and the key can change hands or be lost between the
// crossing and the click. Whoever presses it must still hold the key.
//
// "Leave it open" is a conditional updateMany against the window the clicker
// was shown, so two people propping the same door in the same moment cannot
// stack two windows — the second is told it is already held.
async function handleKeyedPrompt(interaction, payload) {
  await ack(interaction, { update: true });

  const cut = payload.lastIndexOf(":");
  const result = await holdKeyedOpen(prisma, {
    discordUserId: interaction.user.id,
    linkId: payload.slice(0, cut),
    hold: payload.slice(cut + 1) === "yes",
  });
  if (!result.ok) {
    await respond(interaction, { content: `${result.error}`, components: [] });
    return;
  }
  await respond(interaction, {
    content: result.note ? `» *${result.line}*\n-# ${result.note}` : `» *${result.line}*`,
    components: [],
  });
}

// Ending a hold you imposed, from the button on your own DM: Release for an
// old intercept (docs/systemdocs/INTERCEPT.md), Cancel attack for a fight
// (docs/systemdocs/ATTACK.md). The handleKeyedPrompt shape: update IS the ack,
// and the buttons come off whatever the answer was. The shared half — who may
// end whose hold, and the word owed to the other person — is
// db/lib/dmAnswer.js, so the web's own button cannot drift from this one.
async function handleHoldEnd(interaction, kind, targetId) {
  await ack(interaction, { update: true });

  const result = await answerDmAction(prisma, {
    action: { kind, id: targetId },
    choice: DM_CHOICE.ACCEPT,
    discordUserId: interaction.user.id,
  });
  await respond(interaction, { content: `${result.line}`, components: [] });
  // The gateway twin takes a User, not an id (ARCHITECTURE.md §3) — the
  // bot/src/lib/offers.js#fanOut shape.
  for (const dm of result.dms ?? []) {
    const user = await interaction.client.users.fetch(dm.discordUserId).catch(() => null);
    if (!user) continue;
    await sendDm(user, `» ${dm.content}`).catch((err) =>
      console.error(`Hold release DM to ${dm.discordUserId} failed:`, err.message ?? err),
    );
  }
}

// One message carries both the passenger list and the confirmation, because
// Discord cannot keep them on two: an ephemeral reply is a single editable
// surface, and a second message would leave the first one lying around with
// live buttons on it.
async function handleTravelPick(interaction) {
  await ack(interaction, { update: true });

  const locationId = interaction.values[0];

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  if (!target) {
    await respond(interaction, { content: "That place no longer exists.", components: [] });
    return;
  }
  if (!character) {
    await respond(interaction, { content: "You don't have a living character.", components: [] });
    return;
  }

  // The cost model in one line, and — when they are about to walk a day's road
  // with a horse still in their pocket — a warning before the Confirm rather
  // than a regret after it (docs/systemdocs/CARRY.md §2).
  const crossing = Boolean(character.locationId) && character.zoneId !== target.zoneId;
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { freeZoneMovesPerTurn: true },
  });
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  const candidates = await escortCandidates(prisma, character, openTurn?.number ?? null);
  const bringRow = buildBringRow(candidates);
  const overflow = candidates.length - Math.min(candidates.length, MENU_OPTION_LIMIT);

  // The party is what decides whether the mount's extra crossing survives, so
  // the number quoted below has to count it (MAP.md §3a).
  const party = await partyOf(prisma, character.id);
  // THIS crossing's own count, not a flat one that ignores where it goes — a
  // boat's bonus is earned per crossing (db/lib/mounts.js#boatCrossing), so
  // Forest<->Hills or Hills<->Marshes has to show one more than a crossing
  // the water does nothing for. `crossing` above is only a boolean ("does
  // this leave the zone at all"); the actual zone slugs live here.
  const currentZone = character.zoneId
    ? await prisma.zone.findUnique({ where: { id: character.zoneId }, select: { slug: true } })
    : null;
  const left = crossing
    ? freeMovesLeft(character, config, openTurn, party.length, {
      fromZoneSlug: currentZone?.slug ?? null,
      toZoneSlug: target.zone?.slug ?? null,
    })
    : null;
  const seatWarning = crossing ? freeZoneMovesReason(character, party.length) : null;

  const cost = !character.locationId
    ? "-# Arriving costs you nothing."
    : !crossing
      ? "-# You have free zone moves left, so this is free."
      : left > 0
        ? `-# Crossing into ${target.zone.name} uses 1 of your ${left} free ${left === 1 ? "move" : "moves"} this turn.`
        : `-# You have no free moves left, so crossing into ${target.zone.name} spends your Move.`;

  const stowed = crossing ? stowedMounts(character.tags) : [];
  const stowedLine =
    stowed.length > 0
      ? `-# Your ${listNames(stowed)} ${stowed.length === 1 ? "isn't" : "aren't"} equipped, so ${stowed.length === 1 ? "it does" : "they do"} nothing for you.`
      : null;

  await respond(
    interaction,
    {
      content: [
        `Move to **${target.name}**?`,
        cost,
        seatWarning ? `-# ${seatWarning}` : null,
        stowedLine,
        overflow > 0 ? `-# ${overflow} more not shown — Discord caps this list at 25.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      components: [bringRow, buildConfirmRow(locationId)].filter(Boolean),
    },
    { fleeting: false },
  );
}

// The Bring select WRITES the party — an escort is a row, not a ten-minute
// memory of a click (bot/src/lib/locationTravel.js). Anyone ticked who could
// say no gets the Accept DM instead of being attached, and anyone unticked is
// put down. deferUpdate rather than an `update` payload because the work has
// to happen before there is anything to say about it.
async function handleTravelBring(interaction) {
  await interaction.deferUpdate();

  const character = await loadMover(interaction.user.id);
  if (!character) return;
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const outcome = await applyBring(character, interaction.values ?? [], openTurn);

  for (const dm of outcome.dms) {
    const user = await interaction.client.users.fetch(dm.discordUserId).catch(() => null);
    if (!user) continue;
    await sendDm(user, { content: `» ${dm.content}`, components: dm.components }, { meta: dm.meta }).catch((err) =>
      console.error("Escort ask DM failed:", err.message ?? err),
    );
  }

  const notes = [];
  if (outcome.attached.length > 0) notes.push(`Bringing: ${outcome.attached.join(", ")}`);
  if (outcome.asked.length > 0) notes.push(`Asked: ${outcome.asked.join(", ")}`);
  if (outcome.dropped.length > 0) notes.push(`Left: ${outcome.dropped.join(", ")}`);

  const lines = interaction.message.content
    .split("\n")
    .filter((line) => !line.startsWith("-# Bringing:") && !line.startsWith("-# Asked:") && !line.startsWith("-# Left:"));
  for (const note of notes) lines.push(`-# ${note}`);

  await interaction.editReply({ content: lines.join("\n") }).catch((err) =>
    console.error("Failed to show the party:", err),
  );
}

async function handleTravelConfirm(interaction, locationId) {
  await interaction.deferUpdate();

  const [character, target] = await Promise.all([
    loadMover(interaction.user.id),
    prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } }),
  ]);
  if (!character) {
    await respond(interaction, { content: "You don't have a living character.", components: [] });
    return;
  }
  if (!target) {
    await respond(interaction, { content: "That place no longer exists.", components: [] });
    return;
  }

  const result = await performMove(character, target);
  if (!result.ok) {
    await respond(interaction, { content: `${result.reason}`, components: [] });
    return;
  }

  const brought = result.moved
    .filter((entry) => entry.character.id !== character.id)
    .map((entry) => entry.character.name);
  const parts = [`» Moved to **${target.name}**.`];
  if (result.spentTurn) parts.push("Your Move is spent.");
  if (result.usedFreeMove) {
    parts.push(
      result.freeMovesLeft > 0
        ? `${result.freeMovesLeft} free ${result.freeMovesLeft === 1 ? "move" : "moves"} left this turn.`
        : "That was your last free move this turn.",
    );
  }
  if (brought.length > 0) parts.push(`Bringing ${listNames(brought)}.`);
  const stranded = (result.leftBehind ?? []).filter((e) => e.reason !== "held").map((e) => e.character.name);
  if (stranded.length > 0) parts.push(`${listNames(stranded)} couldn't follow.`);
  // "held" is the one reason the leader IS given, because it is plain to see:
  // somebody has hold of them (INTERCEPT.md). Every other reason stays unnamed
  // — a hidden crawl's refusal would announce that the crawl is there.
  const heldBack = (result.leftBehind ?? []).filter((e) => e.reason === "held").map((e) => e.character.name);
  if (heldBack.length > 0) parts.push(`Somebody has hold of ${listNames(heldBack)}.`);
  // The way was too narrow for what they had out — dismounted rather than
  // refused (db/lib/indoors.js#dismountForNarrowWay), already applied by
  // performLocationMove by the time this reads it.
  if (result.dismounted?.length > 0) {
    parts.push(
      `Too narrow for your ${listNames(result.dismounted)} — you leave ${result.dismounted.length === 1 ? "it" : "them"} and go on foot.`,
    );
  }

  await respond(interaction, { content: parts.join(" "), components: [] });
}

async function handleTravelCancel(interaction) {
  await interaction.update({ content: "» *Canceled.*", components: [] });
  scheduleDismiss(interaction);
}

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

// Moves close MOVE_LOCK_HOURS before the turn ends (db/lib/turnClock.js).
// Returns the refusal text, or null when Moves are still open.
async function moveLockNotice() {
  const [openTurn, frozen] = await Promise.all([
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    clockFrozen(prisma),
  ]);
  if (!openTurn) return null;
  const { locked, cutoffAt, endsAt } = moveWindow(openTurn, { clockFrozen: frozen });
  if (!locked) return null;
  return `Moves for this turn locked at <t:${epochSeconds(cutoffAt)}:t>. The next turn opens <t:${epochSeconds(endsAt)}:R>.`;
}

// A modal must be shown within 3 seconds and cannot be deferred first, so
// this is the only read before it — with an 800ms race so a slow pool
// doesn't cost the player the modal. Submit re-checks the cutoff.
async function handleMoveOpen(interaction) {
  const notice = await Promise.race([
    moveLockNotice().catch((err) => {
      console.error("Move lock check failed:", err);
      return null;
    }),
    new Promise((resolve) => setTimeout(() => resolve(null), 800)),
  ]);
  if (notice) {
    await respond(interaction, notice);
    return;
  }
  await interaction.showModal(buildMoveModal());
}

async function handleMoveSubmit(interaction) {
  // FIRST: this handler does easily enough DB work to pass three seconds
  // under load, and a late ack would make a committed Move look unsent.
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  const result = await fileMove(prisma, {
    character,
    actorDiscordUserId: interaction.user.id,
    moveKind: interaction.fields.getRadioGroup("move:kind"),
    description: interaction.fields.getTextInputValue("move:body"),
  });
  if (!result.ok) {
    await respond(interaction, `${result.error}`);
    return;
  }

  const loaded = await prisma.action.findUnique({
    where: { id: result.action.id },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });

  const { lines } = await confirmMove(loaded, interaction.user.id, { laborRate: result.laborRate });
  await respond(interaction, lines.join("\n"));
}

// setRequired(false) fields may be absent from the submitted payload, and
// fields.getX() throws on a component it can't find.
function optionalText(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId) ?? "";
  } catch {
    return "";
  }
}

// The 🔊 Speak button is gone: its destination picker could never list a Room
// thread or a Conversation (bot/src/lib/speakTargets.js says why), so /message
// — run in the room you want to speak in — is the whole feature now.
//
// This stub stays because #turns is ONE ROLLING MESSAGE replaced each turn
// (db/lib/turnAnnouncement.js), so a console posted before the deploy keeps a
// live button for up to a real day, and an unrouted button answers "This
// application did not respond". Delete it once no such message survives.
async function handleSpeakOpen(interaction) {
  await ack(interaction);
  await respond(interaction, "Speak has moved — use /message in the room you want to speak in.");
}

async function handleSpeakSubmit(interaction, channelId) {
  await ack(interaction);

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const { guild, member } = await resolveActingMember(interaction);
  // client.channels, not guild.channels: the destination may be a thread.
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!guild || !channel || !member || !canSpeakInTarget(channel, member)) {
    await respond(interaction, "You can't speak there any more.");
    return;
  }

  const body = optionalText(interaction, "say:body").trim();
  if (!body) {
    await respond(interaction, "Write something.");
    return;
  }

  // Read off the character, never off the modal: concealment (and a held
  // forcesName tag) are standing state, and a checkbox here would be a
  // second answer to a settled question.
  const forcedName = await loadForcedName(prisma, character.id);
  const concealment = await loadConcealment(prisma, character.id);
  const identity = presentedIdentity(character, { forcedName, concealment });

  // Refused here as well as inside postAsCharacterTo. The funnel is the
  // backstop; this is the courtesy, so a silenced player is told before the
  // bot goes and builds a webhook for a message it will not send.
  const voice = await loadVoiceState(character.id);
  if (voice.block) {
    await touchCharacterActivity(prisma, character.id);
    await respond(interaction, `You can't get the words out — you're ${voice.block.name}.`);
    return;
  }

  // The one write path (db/lib/say.js): decide, post, record. The same three
  // calls the proxy makes, in the same order, so the Speak modal and a typed
  // message are gated and transformed identically.
  const prepared = await prepareSpeech(prisma, {
    character,
    placeKey: await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id }),
    content: body,
    source: "DISCORD",
  });
  if (!prepared.ok) {
    await respond(interaction, `${prepared.refusal}`);
    return;
  }

  let posted;
  try {
    posted = await postAsCharacterTo(channel, character, {
      content: prepared.content,
      identity: prepared.identity,
    });
  } catch (err) {
    console.error("Failed to post a Speak message:", err);
    await respond(interaction, "Couldn't post that.");
    return;
  }

  await recordSpeech(prisma, prepared, {
    discordMessageId: posted.webhookMessage.id,
    ...resolveChannelContext(channel),
  });
  await touchCharacterActivity(prisma, character.id);

  await respond(interaction, `» *Sent.*\n${messageLink(guild.id, channel.id, posted.webhookMessage.id)}`);
}

// /message is contextual: it speaks into the channel or thread you ran it in.
// There is no destination picker any more, so run it somewhere you cannot
// speak — a DM, or #turns — and it says where to run it instead.
//
// showModal IS the acknowledgement and a deferred interaction can no longer
// open one, so the speakable case must be tested BEFORE anything is acked, and
// only the refusal branch calls ack().
async function handleMessageCommand(interaction) {
  const channel = interaction.channel;
  if (interaction.inGuild() && interaction.member && channel && canSpeakInTarget(channel, interaction.member)) {
    await interaction.showModal(buildSpeakModal(channel.id, `#${channel.name}`));
    return;
  }
  await ack(interaction);
  await respond(interaction, "Run this in the channel or thread you want to speak in.");
}

// GM-only, and deliberately not the player medic path
// (web/app/(app)/character/requestActions.js#healCharacterRequest), which
// charges a payer and requires co-location. Category is the only filter.
async function handleHealCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "GMs only.");
    return;
  }
  await ack(interaction);

  const role = interaction.options.getRole("character", true);
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, "That isn't a living character's role.");
    return;
  }

  const afflictions = target.tags.filter((ct) => ct.tag.category === HEALTH_CATEGORY);
  if (afflictions.length === 0) {
    await respond(interaction, `${target.name} has nothing to treat.`);
    return;
  }

  // Discord caps a select menu at 25 options, and max_values must track the
  // slice or the whole component is rejected.
  const shown = afflictions.slice(0, MENU_OPTION_LIMIT);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`heal:pick:${target.id}`)
    .setPlaceholder("What to clear…")
    .setMinValues(1)
    .setMaxValues(shown.length)
    .addOptions(shown.map((ct) => ({ label: ct.tag.name, value: ct.tagId })));

  const truncated = afflictions.length > shown.length;
  await respond(interaction, {
    content:
      `Clear what from **${target.name}**?` +
      (truncated ? `\n-# Showing the first ${shown.length} of ${afflictions.length}.` : ""),
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handleHealPick(interaction, characterId) {
  if (!isGmMember(interaction)) {
    await interaction.update({ content: "» *GMs only.*", components: [] });
    scheduleDismiss(interaction);
    return;
  }
  await interaction.deferUpdate();

  const tagIds = interaction.values;
  const target = await prisma.character.findUnique({
    where: { id: characterId },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) {
    await respond(interaction, { content: "That character no longer exists.", components: [] });
    return;
  }

  const cleared = target.tags.filter((ct) => tagIds.includes(ct.tagId)).map((ct) => ct.tag.name);

  await prisma.$transaction(async (tx) => {
    for (const tagId of tagIds) {
      await dropCharacterTag(tx, characterId, tagId);
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "gm_heal",
      targetCharacterId: characterId,
      details: { tagIds, tagNames: cleared },
    },
  });

  // Clearing an affliction can change both narrowcast access and which
  // private Rooms this character belongs in — a key tag is a tag like any
  // other, and #cerberon is gated on tags too.
  await reconcileNarrowcastAccess(prisma, target.id, target.discordUserId).catch((err) =>
    console.error(`Heal: narrowcast reconcile failed for ${target.name}:`, err.message ?? err),
  );
  // Carry first (a cured tag can't change a cap, but the order is the rule
  // — CARRY.md), then the room doors.
  const carry = await settleCarry(prisma, target.id).catch((err) => {
    console.error(`Heal: carry settle failed for ${target.name}:`, err.message ?? err);
    return null;
  });
  await syncCharacterRoomAccess(prisma, target).catch((err) =>
    console.error(`Heal: room access sync failed for ${target.name}:`, err.message ?? err),
  );
  if (carry?.drop) await deliverCarryDrop(prisma, carry).catch(() => { });

  await respond(interaction, {
    content: `Cleared ${cleared.join(", ")} from ${target.name}.`,
    components: [],
  });
}

// The one die a player rolls for themselves. db/lib/roll.js#castDie is the
// shared implementation, as it is for the web's Chat composer — it writes the
// die as a SYSTEM archive row and posts the same sentence to Discord, rather
// than a public interaction reply, which would carry Discord's "@account used
// /roll" header and out the player behind the character (PROXYING.md).
//
// This handler used to post `» *A die is cast* — **N**` and record nothing, so
// a die rolled on Discord was a die Chat and /archive never saw. It is also
// why the roller is named now: a die is an act, not a noise, and a concealed
// roller is named by their alias.
async function handleRollCommand(interaction) {
  await ack(interaction);

  // A die is cast in front of people, so the same gate the other two
  // moment-to-moment verbs use: a Room or a Conversation and nowhere else
  // (db/lib/placeKey.js#isScenePlaceKey). castDie does not ask this — it takes
  // any place key — so the gate stays here, where it was. Without it a die
  // rolls into whatever channel it was typed in: the street, a zone #summary,
  // #turns.
  const channel = interaction.channel;
  const placeKey = channel
    ? await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id })
    : null;
  if (!isScenePlaceKey(placeKey)) {
    await respond(interaction, "There's nobody here to see it.");
    return;
  }

  // The whole row: castDie needs age, gender, concealed and webOnly to work
  // out what to call the roller.
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  const result = await castDie(prisma, character, placeKey);
  await respond(interaction, result.ok ? result.line : result.error);
}

// /play: the Instrument tag's one verb. db/lib/instrumentPlay.js is the
// shared implementation — the web's Chat composer offers the same command
// (COMMANDS.md), and a cooldown or a mood soothe that only one face knew
// about would be a lute a player could dodge by switching apps.
async function handlePlayCommand(interaction) {
  await ack(interaction);

  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  // Where: a Room or a Conversation, and nowhere else (db/lib/placeKey.js
  // #isScenePlaceKey). That refuses a zone #summary and #cerberon, which are
  // not places anyone is standing — and the open street too: a Location
  // channel is scenery with no Send on it, so playing into one would be
  // performing to a room the game says nobody is talking in.
  const channel = interaction.channel;
  const placeKey = channel
    ? await placeKeyForChannel(prisma, { channelId: channel.id, parentId: channel.parent?.id })
    : null;
  if (!isScenePlaceKey(placeKey)) {
    await respond(interaction, "There's nobody here to hear it.");
    return;
  }

  const result = await playInstrument(prisma, character, placeKey);
  await respond(interaction, result.ok ? result.line : result.error);
}

// /shout — the one thing a character can say that leaves the room they said
// it in. db/lib/shout.js is the shared implementation, the way
// handlePlayCommand above uses db/lib/instrumentPlay.js: the voice gate, the
// five-minute cooldown, a soundproof room, a gag, the shouter's presented name
// and the delivery all live there, so the two faces cannot drift.
//
// They had. This handler kept its own copy for a while — a cooldown in a Map
// that died on every restart, no soundproofing, nobody named, and no archive
// row at all — which meant a shout made on Discord reached nobody on the web
// and was missing from /archive.
async function handleShoutCommand(interaction) {
  await ack(interaction);

  // shout() refuses an empty body too, but asking here keeps the better
  // ordering: somebody who typed nothing should be told to say something
  // rather than that there is nobody to hear it.
  const text = interaction.options.getString("message")?.trim();
  if (!text) {
    await respond(interaction, "Say something.");
    return;
  }

  const character = await prisma.character.findFirst({
    where: { discordUserId: interaction.user.id, status: "ALIVE" },
    // discordUserId because shout() stamps the cooldown's AuditLog row with
    // it. Without it the row is written with an empty actor and /gm/audit
    // cannot read a shout back to a person.
    select: { id: true, locationId: true, discordUserId: true },
  });
  if (!character) {
    await respond(interaction, "You don't have a living character.");
    return;
  }

  // Where the CHARACTER stands is what the shout is anchored to, not the
  // channel it was typed in — the two can disagree, and only one of them is a
  // place a voice comes from. But the channel still has to be a scene you are
  // in: a Room or a Conversation (db/lib/placeKey.js#isScenePlaceKey), never a
  // zone #summary, a DM, or the open street, which takes no voice at all.
  const shoutChannel = interaction.channel;
  const placeKey = shoutChannel
    ? await placeKeyForChannel(prisma, { channelId: shoutChannel.id, parentId: shoutChannel.parent?.id })
    : null;
  if (!isScenePlaceKey(placeKey)) {
    await respond(interaction, "There's nobody here to hear it.");
    return;
  }

  // Every refusal past this point is shout()'s, in finished sentences respond()
  // prints as they stand — the empty body, no living character, nowhere to
  // stand, a mute, and the cooldown with its minutes already counted.
  const result = await shout(prisma, character, text, { placeKey });
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }

  // Delivery, and it cannot fail the shout: the cooldown is already spent, so
  // a dead channel is one audience short rather than a refusal. That is why
  // the old `posted === 0` check had to go with it — a shout from a soundproof
  // room posts to zero Location channels BY DESIGN, and reporting failure on
  // one was telling the player nothing happened when it had and had cost them
  // five minutes of throat.
  await deliverShout(prisma, { placeKey, here: result.here, heard: result.heard });

  await respond(interaction, result.line);
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "zone") return void (await handleZoneCommand(interaction));
        if (interaction.commandName === "dm") return void (await handleGmDmCommand(interaction));
        if (interaction.commandName === "heal") return void (await handleHealCommand(interaction));
        if (interaction.commandName === "add" || interaction.commandName === "remove") {
          return void (await handleThreadMemberCommand(interaction, interaction.commandName));
        }
        if (interaction.commandName === "move") return void (await handleMoveOpen(interaction));
        if (interaction.commandName === "location" || interaction.commandName === "travel")
          return void (await handleTravelOpen(interaction));
        if (interaction.commandName === "conceal") return void (await handleConcealCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "roll") return void (await handleRollCommand(interaction));
        if (interaction.commandName === "play") return void (await handlePlayCommand(interaction));
        if (interaction.commandName === "shout") return void (await handleShoutCommand(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleTravelOpen(interaction));
        if (interaction.customId === CANCEL_ID) return void (await handleTravelCancel(interaction));
        if (interaction.customId.startsWith(CONFIRM_PREFIX)) {
          return void (await handleTravelConfirm(interaction, interaction.customId.slice(CONFIRM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(WHOS_HERE_PREFIX)) {
          return void (await handleWhosHere(interaction, interaction.customId.slice(WHOS_HERE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_STORAGE_PREFIX)) {
          return void (await handleRoomStorage(interaction, interaction.customId.slice(ROOM_STORAGE_PREFIX.length)));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleQuestOpen.
        if (interaction.customId.startsWith(QUEST_INTERACT_PREFIX)) {
          return void (await handleQuestOpen(interaction, interaction.customId.slice(QUEST_INTERACT_PREFIX.length)));
        }
        // Opens a modal, so it must NOT be ack()'d first — see handleIntercomOpen.
        if (interaction.customId.startsWith(ROOM_INTERCOM_PREFIX)) {
          return void (await handleIntercomOpen(interaction, interaction.customId.slice(ROOM_INTERCOM_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_TURRET_PREFIX)) {
          return void (await handleTurretOpen(interaction, interaction.customId.slice(ROOM_TURRET_PREFIX.length)));
        }
        // The confirm first: "room:pray:go:<id>" also starts with the open
        // prefix, so testing the other way round would route every confirm
        // back into the dialog it came from.
        if (interaction.customId.startsWith(PRAY_CONFIRM_PREFIX)) {
          return void (await handlePrayConfirm(
            interaction,
            interaction.customId.slice(PRAY_CONFIRM_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(ROOM_PRAY_PREFIX)) {
          return void (await handlePrayOpen(interaction, interaction.customId.slice(ROOM_PRAY_PREFIX.length)));
        }
        if (interaction.customId.startsWith(ROOM_BELL_PREFIX)) {
          return void (await handleBellOpen(interaction, interaction.customId.slice(ROOM_BELL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(SECRET_ROOMS_PREFIX)) {
          return void (await handleSecretRooms(interaction, interaction.customId.slice(SECRET_ROOMS_PREFIX.length)));
        }
        if (interaction.customId.startsWith(EXAMINE_PREFIX)) {
          return void (await handleExamine(interaction, interaction.customId.slice(EXAMINE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(CONVERSE_PREFIX)) {
          return void (await handleConverseOpen(interaction, interaction.customId.slice(CONVERSE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(GATE_PREFIX)) {
          return void (await handleGateToggle(interaction, interaction.customId.slice(GATE_PREFIX.length)));
        }
        if (interaction.customId.startsWith(KEYED_PREFIX)) {
          return void (await handleKeyedPrompt(interaction, interaction.customId.slice(KEYED_PREFIX.length)));
        }
        if (interaction.customId.startsWith(INTERCEPT_RELEASE_PREFIX)) {
          return void (await handleHoldEnd(
            interaction,
            DM_ACTION.INTERCEPT_HOLD,
            interaction.customId.slice(INTERCEPT_RELEASE_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(ATTACK_CANCEL_PREFIX)) {
          return void (await handleHoldEnd(
            interaction,
            DM_ACTION.ATTACK_HOLD,
            interaction.customId.slice(ATTACK_CANCEL_PREFIX.length),
          ));
        }
        if (interaction.customId === "move:open") return void (await handleMoveOpen(interaction));
        if (interaction.customId === "say:open") return void (await handleSpeakOpen(interaction));
        // Arrive in a DM on a consent offer (docs/systemdocs/LESSONS.md), so
        // guild/member are null. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(OFFER_ACCEPT_PREFIX)) {
          return void (await handleOfferAccept(interaction, interaction.customId.slice(OFFER_ACCEPT_PREFIX.length)));
        }
        if (interaction.customId.startsWith(OFFER_DECLINE_PREFIX)) {
          return void (await handleOfferDecline(interaction, interaction.customId.slice(OFFER_DECLINE_PREFIX.length)));
        }
        // Arrives in a DM on a threat spawn offer (docs/systemdocs/THREATS.md),
        // so guild/member are null — and the clicker has no character yet,
        // which is the whole point. Not acked: interaction.update() is the ack.
        if (interaction.customId.startsWith(THREAT_SPAWN_ACCEPT_PREFIX)) {
          return void (await handleThreatSpawnAccept(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_ACCEPT_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(THREAT_SPAWN_DECLINE_PREFIX)) {
          return void (await handleThreatSpawnDecline(
            interaction,
            interaction.customId.slice(THREAT_SPAWN_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on a tax (docs/tags.yaml's `taxman` description), so
        // guild/member are null.
        if (interaction.customId.startsWith(PENDING_TAX_DECLINE_PREFIX)) {
          return void (await handleTaxDecline(
            interaction,
            interaction.customId.slice(PENDING_TAX_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on an assignment (docs/systemdocs/LOBBY.md §4), so
        // guild/member are null and the clicker has no character yet.
        if (interaction.customId.startsWith(LOBBY_DECLINE_PREFIX)) {
          return void (await handleLobbyDecline(
            interaction,
            interaction.customId.slice(LOBBY_DECLINE_PREFIX.length),
          ));
        }
        // Arrives in a DM on a Bird's letter, so guild/member are null.
        if (interaction.customId.startsWith(BIRD_REPLY_PREFIX)) {
          return void (await handleBirdReplyOpen(interaction, interaction.customId.slice(BIRD_REPLY_PREFIX.length)));
        }
        // The board on a Location's anchor. Shown only where docs/zones.yaml
        // declared one (db/lib/noticeboard.js).
        if (interaction.customId.startsWith(NOTICEBOARD_PREFIX)) {
          return void (await handleNoticeboardOpen(interaction, interaction.customId.slice(NOTICEBOARD_PREFIX.length)));
        }
        // The GM's third row: a button where a player gets the Pin select,
        // because a GM holds no paper and writes the notice on the spot. It
        // opens a modal, so the handler must NOT be acked first.
        if (interaction.customId.startsWith(NOTICE_POST_PREFIX)) {
          return void (await handleNoticePost(interaction, interaction.customId.slice(NOTICE_POST_PREFIX.length)));
        }
        if (interaction.customId === REPORT_OPEN_ID) return void (await handleReportOpen(interaction));
        if (interaction.customId === REPORT_CLOSE_ID) return void (await handleReportClose(interaction));
        // Arrives in a DM; must NOT be acked first since it opens a modal.
        if (interaction.customId.startsWith(EDIT_OPEN_PREFIX)) return void (await handleEditOpen(interaction));
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === ZONE_VIEW_ID) return void (await handleZoneViewPick(interaction));
        if (interaction.customId === PICK_ID) return void (await handleTravelPick(interaction));
        if (interaction.customId === BRING_ID) {
          return void (await handleTravelBring(interaction));
        }
        // Must NOT be acked first: it opens a modal.
        if (interaction.customId.startsWith(CONVERSE_ROOM_PREFIX)) {
          return void (await handleConverseRoomPick(interaction));
        }
        if (interaction.customId.startsWith("heal:pick:")) {
          return void (await handleHealPick(interaction, interaction.customId.slice("heal:pick:".length)));
        }
        // Answering a bird: which letter in your hands goes back.
        if (interaction.customId.startsWith(BIRD_REPLY_PICK_PREFIX)) {
          return void (await handleBirdReplyPick(interaction, interaction.customId.slice(BIRD_REPLY_PICK_PREFIX.length)));
        }
        // The three verbs on a noticeboard. Read is free to anyone standing
        // here; whether they can make anything of it is a separate question
        // the handler asks (db/lib/reading.js).
        if (interaction.customId.startsWith(NOTICE_READ_PREFIX)) {
          return void (await handleNoticeRead(interaction, interaction.customId.slice(NOTICE_READ_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_TEAR_PREFIX)) {
          return void (await handleNoticeTear(interaction, interaction.customId.slice(NOTICE_TEAR_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_PIN_PREFIX)) {
          return void (await handleNoticePin(interaction, interaction.customId.slice(NOTICE_PIN_PREFIX.length)));
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === "move:new") return void (await handleMoveSubmit(interaction));
        if (interaction.customId.startsWith(CONVERSE_MODAL_PREFIX)) {
          return void (await handleConverseCreate(interaction, interaction.customId.slice(CONVERSE_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(NOTICE_POST_MODAL_PREFIX)) {
          return void (await handleNoticePostSubmit(
            interaction,
            interaction.customId.slice(NOTICE_POST_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(QUEST_MODAL_PREFIX)) {
          return void (await handleQuestSubmit(interaction, interaction.customId.slice(QUEST_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith(INTERCOM_MODAL_PREFIX)) {
          return void (await handleIntercomSubmit(
            interaction,
            interaction.customId.slice(INTERCOM_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(TURRET_MODAL_PREFIX)) {
          return void (await handleTurretSubmit(
            interaction,
            interaction.customId.slice(TURRET_MODAL_PREFIX.length),
          ));
        }
        if (interaction.customId.startsWith(BELL_MODAL_PREFIX)) {
          return void (await handleBellSubmit(interaction, interaction.customId.slice(BELL_MODAL_PREFIX.length)));
        }
        if (interaction.customId.startsWith("say:send:")) {
          return void (await handleSpeakSubmit(interaction, interaction.customId.slice("say:send:".length)));
        }
        if (interaction.customId.startsWith(EDIT_MODAL_PREFIX)) return void (await handleEditSubmit(interaction));
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
      await respondToFailure(interaction);
    }
  },
};

async function respondToFailure(interaction) {
  if (!interaction.isRepliable?.()) return;
  await respond(interaction, { content: "Something went wrong — that didn't go through.", components: [] });
}
