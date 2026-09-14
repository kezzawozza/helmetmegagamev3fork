const { syncMemberNickname } = require("../lib/nickname");

// Fires on a username/global name/avatar change — re-syncs the nickname right away.
module.exports = {
  name: "userUpdate",
  async execute(oldUser, newUser) {
    for (const guild of newUser.client.guilds.cache.values()) {
      const member = guild.members.cache.get(newUser.id);
      if (member) await syncMemberNickname(member).catch(() => {});
    }
  },
};
