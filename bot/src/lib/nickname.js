const { prisma, formatBareName } = require("@lifeweb/db");
const { buildNickname } = require("@lifeweb/db/lib/nicknameFormat");

// Never uses member.nickname as the base — that's this sync's own past
// output, and feeding it back in would compound on every change. Returns
// "updated" | "skipped" | "failed" so callers can log a summary.
async function syncMemberNickname(member) {
  // `manageable` is false for the guild owner and anyone whose highest role
  // sits at or above the bot's — declining here costs zero API calls, rather
  // than retrying a 403 forever (db/lib/discordRest.js's breaker).
  if (member.user.bot) return "skipped";
  if (!member.manageable) return "skipped";

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) return "skipped";

  const character = await prisma.character.findFirst({
    where: { discordUserId: member.id, status: "ALIVE", firstName: { not: "" } },
  });
  if (!character) return "skipped";
  if (character.webOnly) return "skipped"; // CHAT.md §6: this account must stay unidentifiable as the character

  const base = member.user.displayName;
  // Bare (first + last), not titled — the 32-char cap is shared between the
  // two halves, and titling would truncate every nickname to garbage.
  // web/lib/discordGuild.js#syncCharacterNickname does the same.
  const nickname = buildNickname(base, formatBareName(character));
  if (member.nickname === nickname) return "skipped";

  try {
    await member.setNickname(nickname);
    return "updated";
  } catch (err) {
    console.error(`Failed to set nickname for ${member.user.tag} (${member.id}): ${err.message}`);
    return "failed";
  }
}

// One-time bulk catch-up, called from ready.js (`once: true`) — a gateway
// drop the process survives never re-runs it, unlike messageCatchUp.js which
// also hangs off shardReady since a missed message is lost for good.
async function syncNicknamesForGuild(guild) {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } }); // gated once for the whole guild
  if (!config?.nicknameSyncEnabled) {
    console.log(`Nickname sync for guild ${guild.name}: disabled, skipped.`);
    return;
  }

  await guild.members.fetch();
  const results = { updated: 0, skipped: 0, failed: 0 };
  for (const member of guild.members.cache.values()) {
    const result = await syncMemberNickname(member);
    results[result] += 1;
  }
  console.log(
    `Nickname sync for guild ${guild.name}: ${results.updated} updated, ${results.skipped} skipped, ${results.failed} failed`,
  );
}

module.exports = { buildNickname, syncMemberNickname, syncNicknamesForGuild };
