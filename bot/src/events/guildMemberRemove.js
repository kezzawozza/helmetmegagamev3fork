const { prisma } = require("@lifeweb/db");
const { markPlayerDeparted } = require("@lifeweb/db/lib/playerDeparture");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("@lifeweb/db/lib/constants");

// A leave flags the character Catatonic and starts a death countdown (db/lib/catatonicDeathPass.js);
// rejoining and speaking in character wakes them. Leaves the bot sleeps through are caught by the
// startup reconcile (bot/src/lib/leaveReconcile.js).
module.exports = {
  name: "guildMemberRemove",
  async execute(member) {
    if (member.user?.bot) return;

    const playerName = member.user?.username ?? member.user?.tag ?? member.id;
    const result = await markPlayerDeparted(prisma, {
      discordUserId: member.id,
      username: playerName,
    });

    const channel = await member.client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch((err) => {
      console.error(`Leave alert: cannot fetch #leave (${LEAVE_ANNOUNCE_CHANNEL_ID}):`, err.message);
      return null;
    });
    if (!channel?.isTextBased()) {
      console.error(`Leave alert: #leave is missing or not text-based — ${playerName}'s departure went unannounced.`);
    } else {
      await channel
        .send(result.alert)
        .catch((err) => console.error(`Leave alert send failed for ${playerName}:`, err.message));
    }

    if (result.roleUpdate) { // grey "<name> • Catatonic" rename; role stays held by nobody (PROXYING.md §6)
      await member.guild.roles
        .edit(result.roleUpdate.roleId, { name: result.roleUpdate.name, color: result.roleUpdate.color })
        .catch((err) =>
          console.error(`Failed to mark ${result.character?.name}'s role catatonic on departure:`, err.message),
        );
    }
  },
};
