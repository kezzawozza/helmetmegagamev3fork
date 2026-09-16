// The one line the game says back when a player writes to the GMs. It sets the expectation that
// most questions belong in #questions rather than in somebody's inbox, and it says so quietly:
// `-#` subtext, QUIET so it is logged but never drawn on the GM desk (db/lib/dmKinds.js) — a GM
// reading their mail should see the player's words and nothing of ours underneath them.
//
// Rate-limited to one line per player per 10 minutes, so somebody typing five messages in a row
// gets told once. THE COOLDOWN STATE IS THE LOG ROW ITSELF — the last OUTBOUND row carrying
// AUTO_REPLY_SOURCE — rather than a column on Character: there is no character behind a raw Discord
// account, and the window then holds across both entry points (a Discord DM and the Chat composer)
// for free.
const { DM_KIND } = require("./dmKinds");

// One guild, one correct value, not a secret — the db/lib/roleIds.js reasoning. Written as a MASKED
// link rather than a `<#id>` mention because the web deliberately renders a channel mention as a
// bare "somewhere" (CLAUDE.md, "Bot message style"); a masked link is named and clickable on both
// faces, and being built from the id it survives the channel being renamed.
const QUESTIONS_CHANNEL_ID = "1539643927248765029";

const AUTO_REPLY_SOURCE = "gm_auto_reply";
const AUTO_REPLY_WINDOW_MS = 10 * 60 * 1000;

// A Discord channel URL needs the guild too. With no guild configured there is no honest link to
// write, so the line names the channel in plain text rather than shipping a `.../undefined/...`
// href that goes nowhere.
function questionsChannelUrl() {
  const guildId = process.env.DISCORD_GUILD_ID;
  return guildId ? `https://discord.com/channels/${guildId}/${QUESTIONS_CHANNEL_ID}` : null;
}

function autoReplyText() {
  const url = questionsChannelUrl();
  return (
    "-# GMs are only available to solve unintended bugs and deal with OOC disputes. " +
    `If you have questions about the game, please use ${url ? `[#questions](${url})` : "#questions"}. ` +
    "Your message may not be answered."
  );
}

// Best-effort by design: a player with closed DMs, or a Discord hiccup, must never stop their own
// message being filed. Required lazily so this module stays cheap for callers that only want the
// constants, and so the REST transport is loaded by path rather than off the barrel (CLAUDE.md).
async function maybeSendGmAutoReply(prisma, discordUserId) {
  if (!discordUserId) return { sent: false, reason: "no-recipient" };
  try {
    const recent = await prisma.directMessage.count({
      where: {
        discordUserId,
        direction: "OUTBOUND",
        source: AUTO_REPLY_SOURCE,
        createdAt: { gte: new Date(Date.now() - AUTO_REPLY_WINDOW_MS) },
      },
    });
    if (recent > 0) return { sent: false, reason: "cooldown" };

    const { sendDm } = require("./dm");
    await sendDm(prisma, discordUserId, autoReplyText(), {
      kind: DM_KIND.QUIET,
      source: AUTO_REPLY_SOURCE,
    });
    return { sent: true };
  } catch (err) {
    console.error(`[dm] auto-reply to ${discordUserId} failed:`, err?.message ?? err);
    return { sent: false, reason: "error" };
  }
}

module.exports = {
  QUESTIONS_CHANNEL_ID,
  AUTO_REPLY_SOURCE,
  AUTO_REPLY_WINDOW_MS,
  autoReplyText,
  maybeSendGmAutoReply,
};
