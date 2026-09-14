// Admin-facing interaction handlers: /zone and its select-menu pick,
// /gm, /dm, thread member add/remove, and the room-guest let-in/out flow.
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { setVisibleZones } = require("@lifeweb/db/lib/gmZoneView");
const { syncGmZoneRoles } = require("@lifeweb/db/lib/gmZoneRoles");
const {
  addConversationMember,
  removeConversationMember,
  isConversationMember,
} = require("@lifeweb/db/lib/conversations");
const { sendDm } = require("../../lib/dm");
const { resolveActingMember, isGmMember, findAliveCharacter } = require("../../lib/interactionGuild");
const { presentedNameOf } = require("@lifeweb/db/lib/presentedMembers");
const { addRoomGuest, removeRoomGuest } = require("@lifeweb/db/lib/roomGuests");
const { notifyPresence } = require("@lifeweb/db/lib/presenceNotify");
const { addThreadMember } = require("@lifeweb/db/lib/discordRest");
const { DM_KIND } = require("@lifeweb/db/lib/dmKinds");
const { ack, respond, scheduleDismiss } = require("../../lib/respond");

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


module.exports = {
  ZONE_VIEW_ID,
  handleZoneCommand,
  handleZoneViewPick,
  handleGmCommand,
  handleGmDmCommand,
  handleThreadMemberCommand,
  handleRoomGuestCommand,
};
