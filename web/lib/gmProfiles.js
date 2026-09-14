import { cache } from "react";
import { hasGmRole } from "@lifeweb/db/lib/roleIds";
import { listGuildMembers } from "./discordGuild";

// GM roster with avatars. DERIVED from discordGuild.js#listGuildMembers rather than fetched.
function avatarUrlFor(guildId, member) {
  if (member.guildAvatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${member.id}/avatars/${member.guildAvatar}.png?size=64`;
  }
  if (member.avatar) {
    return `https://cdn.discordapp.com/avatars/${member.id}/${member.avatar}.png?size=64`;
  }
  return null;
}

export const getGmProfiles = cache(async () => {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return [];
  const members = await listGuildMembers();
  return members
    .filter((m) => hasGmRole(m.roles))
    .map((m) => ({
      discordUserId: m.id,
      username: m.username,
      avatarUrl: avatarUrlFor(guildId, m),
    }));
});
