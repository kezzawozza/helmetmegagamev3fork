// REST-based logged DM — the third twin of bot/src/lib/dm.js#sendDm (gateway) and web/lib/discordGuild.js#sendDm
// (web REST), used by db/index.js's advanceTurn/resolveNeeds path, which can't rely on a gateway client.
// Takes `prisma` as a parameter rather than require("../index") (partial exports object otherwise).
// Deliberately NOT spread into the db/index.js barrel — a bare `sendDm` would invite the wrong one being grabbed.
const { postDmBatched } = require("./discordRest");
const { applyDmPrefix, dmLogRow } = require("./dmPolicy");

// Applies the `»` prefix (CLAUDE.md "Bot message style") and logs to DirectMessage for /gm/messages.
// The log is best-effort; the send itself throws on a Discord failure, so callers .catch() it.
// postDmBatched splits anything over Discord's 2000 characters; one log row carries the whole text.
// `opts.components`/`opts.embeds` land on the LAST chunk postDmBatched sends.
async function sendDm(prisma, discordUserId, content, opts = {}) {
  const formatted = applyDmPrefix(content);
  const message = await postDmBatched(discordUserId, formatted, {
    components: opts.components,
    embeds: opts.embeds,
    // Pass one whenever the line carries player-typed text, so it can't ping the room from someone's inbox.
    allowedMentions: opts.allowedMentions,
  });
  // Prefix, kind/source defaults and row shape are one decision shared with the other two transports — db/lib/dmPolicy.js.
  await prisma.directMessage
    .create({
      data: dmLogRow({
        discordUserId,
        content: formatted,
        opts,
        discordMessageId: message?.id ?? null,
        hasEmbeds: Boolean(opts.embeds?.length),
      }),
    })
    .catch(() => {});
  return message;
}

module.exports = { sendDm };
