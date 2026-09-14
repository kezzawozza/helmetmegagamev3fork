// Discord gives a bot three seconds to acknowledge, so `ack` must run before any database work.
// `respond` puts the reply through `ephemeralLine`, so a call site just writes a plain sentence.

const { MessageFlags } = require("discord.js");
const { ephemeralLine } = require("./ephemeralLine");

const DISCORD_MESSAGE_LIMIT = 2000;
const TRUNCATION_NOTE = "\n-# …trimmed to fit Discord's 2000-character limit.";

const FLEETING_DELETE_DELAY_MS = 60_000; // well inside the interaction token's 15-minute life

// Trims to Discord's limit rather than letting the send fail on work already done.
function clampContent(content) {
  const text = String(content ?? "");
  if (text.length <= DISCORD_MESSAGE_LIMIT) return text;
  return text.slice(0, DISCORD_MESSAGE_LIMIT - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}

// Self-delete after FLEETING_DELETE_DELAY_MS; exported for sites that skip `respond` but still want it.
function scheduleDismiss(interaction) {
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, FLEETING_DELETE_DELAY_MS);
}

// `update: true` for a component interaction being edited in place, so Discord posts no second "thinking" message.
async function ack(interaction, { update = false, ephemeral = true } = {}) {
  if (interaction.deferred || interaction.replied) return;
  try {
    if (update) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }
  } catch (err) {
    console.error("Failed to acknowledge interaction:", err); // log and carry on; work still has to finish
  }
}

// Picks edit/follow-up/reply from what's already happened. Never throws. Self-deletes after
// FLEETING_DELETE_DELAY_MS by default; pass `fleeting: false` to opt out.
async function respond(interaction, payload, { fleeting = true } = {}) {
  const options = typeof payload === "string" ? { content: payload } : { ...payload };
  if (options.content !== undefined) { // house format first, clamp second, so the chevron stays inside the 2000-char budget
    options.content = clampContent(ephemeralLine(options.content, { components: options.components }));
  }

  try {
    if (interaction.deferred) {
      await interaction.editReply(options);
    } else if (interaction.replied) {
      await interaction.followUp({ ...options, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error("Failed to respond to interaction:", err);
    return;
  }

  if (fleeting) scheduleDismiss(interaction);
}

module.exports = { ack, respond, scheduleDismiss, DISCORD_MESSAGE_LIMIT };
