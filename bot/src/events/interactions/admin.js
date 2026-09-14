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

// /zone — the Discord twin of the Zones control on the GM desks' inspector; both write the same
// GmZoneView rows. Nothing selected means EVERY zone, so min_values is 0.
async function handleZoneCommand(interaction) {
  if (!isGmMember(interaction)) {
    await respond(interaction, "GMs only.");
    return;
  }
  await ack(interaction);

  const [zones, current] = await Promise.all([
    prisma.zone.findMany({ // only zones with a seat to hand out (web/lib/gmZoneView.js)
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
  await syncGmZoneRoles(prisma, interaction.user.id).catch((err) => // best-effort: a rate limit shouldn't cost the GM their choice
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

  // The message wears the bot's name, so without this line /gm/audit can't answer "who said that".
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


// /dm: DM a chosen server member as the bot itself, logged via bot/src/lib/dm.js#sendDm.
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
    // Same reason /gm writes one: a DM with no record of who sent it is the gap /gm/audit closes.
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
    const closed = err.code === 50007 || err.status === 403; // 50007 is the real closed-DMs code
    await respond(
      interaction,
      closed
        ? "Couldn't deliver that — they have DMs closed."
        : "Couldn't deliver that. It wasn't their DM settings; check the logs.",
    );
  }
}


// /add and /remove work on two things, and the channel decides which: a Conversation (a
// PlayerThread row; /add records a PlayerThreadInvite, replayed on arrival by
// db/lib/threadInvites.js) or a private Room (a RoomGuest row, spent the moment they leave —
// db/lib/roomAccess.js — so the target must already be standing here).
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

  const actor = await findAliveCharacter(interaction.user.id); // membership is the ROWS (db/lib/conversations.js), not Discord's thread-member list
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

  const shown = await presentedNameOf(prisma, target.id, actor); // never `target.name` raw — same resolver the web strip uses

  if (action === "remove") {
    await removeConversationMember(prisma, { playerThreadId: row.id, characterId: target.id }); // the ROW is membership; the thread list is its projection
    await prisma.playerThreadInvite
      .deleteMany({ where: { threadId: channel.id, characterId: target.id } })
      .catch((err) => console.error("Failed to delete thread invite:", err));
    if (target.discordUserId) { // web-only holds no thread seat to take away
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

  // Membership first, wherever they stand — the invite row replays the Discord add on arrival
  // (db/lib/threadInvites.js), but the web feed shows the conversation to a player who never sees the thread.
  await addConversationMember(prisma, { playerThreadId: row.id, characterId: target.id });
  await prisma.playerThreadInvite
    .upsert({
      where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
      update: {},
      create: { threadId: channel.id, characterId: target.id },
    })
    .catch((err) => console.error("Failed to record thread invite:", err));

  if (target.locationId === row.locationId && !target.webOnly && target.discordUserId) { // web-only is out of every channel on purpose (CHAT.md §6)
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


// Discord's own "added to a thread" notice is easy to miss and says nothing about where, so this
// carries the place and a link — never the content, same rule as bot/src/lib/mentions.js.
async function notifyLetIn(interaction, target, threadName, placeName, threadId) {
  if (!target.discordUserId) return;
  const where = placeName ? `${placeName} · ${threadName}` : threadName;
  const user = await interaction.client.users.fetch(target.discordUserId).catch(() => null);
  if (!user) return;
  const link = `https://discord.com/channels/${interaction.guildId}/${threadId}`;
  await sendDm(user, `» *You were let into ${where}.*\n${link}`, { kind: DM_KIND.QUIET }).catch(() => { });
}


// The Room half of /add and /remove. db/lib/roomGuests.js is the rule; this is the Discord end —
// resolve the target from the role picker (never a user, so inviting can't reveal who plays them).
async function handleRoomGuestCommand(interaction, action, room) {
  const role = interaction.options.getRole("character");
  const target = await prisma.character.findFirst({
    where: { discordRoleId: role.id, status: "ALIVE" },
    select: { id: true },
  });
  if (!target) {
    await respond(interaction, "That isn't a living character's role."); // worded for a ROLE, what this face offers
    return;
  }

  const actor = await findAliveCharacter(interaction.user.id);
  const args = { actor, roomId: room.id, characterId: target.id, gm: isGmMember(interaction) };
  const result = action === "remove" ? await removeRoomGuest(prisma, args) : await addRoomGuest(prisma, args);
  if (!result.ok) {
    await respond(interaction, result.error);
    return;
  }

  await notifyPresence(prisma, result.target.id).catch(() => {}); // the guest's own Chat has to hear about the door too
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
