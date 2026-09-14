const { prisma, formatBareName } = require("@lifeweb/db");
const { buildNickname } = require("@lifeweb/db/lib/nicknameFormat");

// Never uses member.nickname as the base — that's this sync's own past
// output, and feeding it back in would compound on every change.
// Returns "updated" | "skipped" | "failed" so callers can log a summary
// instead of failures disappearing into a blanket .catch(() => {}).
async function syncMemberNickname(member) {
  // Checked before any DB work: `manageable` is false for the guild owner and
  // for anyone whose highest role sits at or above the bot's — precisely the
  // members setNickname can only ever answer 403 for. That 403 used to be
  // logged, counted as "failed", and then retried on every single restart
  // forever, which is both pointless and a standing contribution to the
  // Cloudflare invalid-response counter (see the breaker in
  // db/lib/discordRest.js). discord.js computes this from the cached role
  // hierarchy, so declining here costs zero API calls.
  if (member.user.bot) return "skipped";
  if (!member.manageable) return "skipped";

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  if (!config?.nicknameSyncEnabled) return "skipped";

  const character = await prisma.character.findFirst({
    where: { discordUserId: member.id, status: "ALIVE", firstName: { not: "" } },
  });
  if (!character) return "skipped";
  // "Play from the web" (docs/systemdocs/CHAT.md §6): the whole point is that
  // this account is not identifiable as this character, and a nickname reading
  // "someone | Cersei" would hand that back in the member list.
  if (character.webOnly) return "skipped";

  const base = member.user.displayName;
  // Bare (first + last), not the displayed name. The 32-char cap is shared
  // between the two halves — about 14 each — and `Sir Jorren "the Blind"
  // Vask` is 27 on its own, so titling here would truncate every nickname in
  // the guild to garbage. This is the one place a title deliberately does
  // not show. web/lib/discordGuild.js#syncCharacterNickname does the same.
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

// One-time bulk catch-up for whatever drifted while the bot was offline — not
// a recurring poll. Called from ready.js, which is `once: true`, so this is
// once per PROCESS and not once per connect: a gateway drop the process
// survives never re-runs it. Only the message catch-up
// (bot/src/lib/messageCatchUp.js) hangs off shardReady as well, because a
// missed message is lost for good and a stale nickname is merely stale.
async function syncNicknamesForGuild(guild) {
  // Gate once for the whole guild rather than once per member: the per-member
  // path re-reads GameConfig every call, which is a query per guild member
  // (not per character — spectators and lurkers included) on every startup.
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
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
