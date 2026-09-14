const { prisma } = require("@lifeweb/db");
const { hasGmRole } = require("@lifeweb/db/lib/roleIds");
const { syncGmZoneRoles } = require("@lifeweb/db/lib/gmZoneRoles");

// Access rides per-zone "GM: <Zone>" roles, not the global Gamemaster role (GAMEMASTERS.md §6), so
// a fresh promotion needs this to reach any Location channel.
module.exports = {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember) {
    const was = hasGmRole([...(oldMember?.roles?.cache?.keys() ?? [])]);
    const is = hasGmRole([...(newMember?.roles?.cache?.keys() ?? [])]);
    if (was === is) return; // only the transition, either direction

    await syncGmZoneRoles(prisma, newMember.id).catch((err) =>
      console.error(`GM zone view: couldn't reseat ${newMember.id}:`, err.message ?? err),
    );
  },
};
