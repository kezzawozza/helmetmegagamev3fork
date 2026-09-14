const { prisma } = require("@lifeweb/db");
const { PLAYER_ROLE_ID } = require("@lifeweb/db/lib/roleIds");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("@lifeweb/db/lib/constants");
const { syncMemberNickname } = require("../lib/nickname");
const { restoreStandingRoles } = require("../lib/locationTravel");
const { reconcileNarrowcastAccess } = require("@lifeweb/db/lib/locationMove");
const { syncCharacterRoomAccess } = require("@lifeweb/db/lib/roomAccess");

module.exports = {
  name: "guildMemberAdd",
  async execute(member) {
    // Caught so a failed log line can't skip the sync work below it (same reasoning as guildMemberRemove.js).
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: member.id,
          actionType: "member_joined",
          details: { username: member.user.tag },
        },
      })
      .catch((err) => console.error(`Failed to log member_joined for ${member.id}:`, err));

    await syncMemberNickname(member).catch(() => {}); // covers rejoins where a character already exists

    // A rejoining player whose character is still standing — Catatonic on a death countdown since
    // they left (playerDeparture.js). Clearing leftGuildAt lets the catatonic pass's clear branch
    // wake the character once they act in character again; the tag and countdown stay until then.
    const character = await prisma.character
      .findFirst({
        where: { discordUserId: member.id, status: "ALIVE" },
        include: { zone: true, location: true },
      })
      .catch((err) => {
        console.error(`Rejoin lookup failed for ${member.id}:`, err);
        return null;
      });
    if (!character) return;

    // Captured before the clear: a rejoiner departure machinery never saw still gets their roles
    // back below, but isn't announced as Catatonic when they aren't.
    const wasTrackedDeparted = character.leftGuildAt != null;
    if (wasTrackedDeparted) {
      await prisma.character
        .update({ where: { id: character.id }, data: { leftGuildAt: null } })
        .catch((err) => console.error(`Failed to clear leftGuildAt for ${character.name}:`, err));
    }

    await member.roles
      .add(PLAYER_ROLE_ID)
      .catch((err) => console.error(`Failed to re-grant Player to ${member.id}:`, err.message));
    // Pure re-grant, same shape Revive uses (CHARACTERS.md §5b). Turn-ping etc left to the doctor's next cheap pass.
    await restoreStandingRoles(member, character).catch((err) =>
      console.error(`Failed to restore ${character.name}'s standing roles on rejoin:`, err.message),
    );
    await reconcileNarrowcastAccess(prisma, character.id, member.id).catch((err) =>
      console.error(`Failed to restore ${character.name}'s narrowcast access on rejoin:`, err.message),
    );
    await syncCharacterRoomAccess(prisma, character).catch((err) =>
      console.error(`Failed to restore ${character.name}'s room access on rejoin:`, err.message),
    );

    if (wasTrackedDeparted) {
      const channel = await member.client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch(() => null);
      if (channel?.isTextBased()) {
        await channel
          .send(`${member.user.username} rejoined — ${character.name} is still **Catatonic** until they speak.`)
          .catch((err) => console.error(`Rejoin alert send failed for ${member.id}:`, err.message));
      }
    }
  },
};
