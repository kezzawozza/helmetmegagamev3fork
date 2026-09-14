const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// A modal avoids the typing indicator that would fire under the player's REAL Discord account.
// Concealment isn't asked here — it's a standing state (Character.concealed via /conceal), so a
// checkbox would contradict a question already settled.
const SPEAK_HELP = "-# Sent as your character. Nobody sees you typing.";

// customId carries the destination, so submit needs no state of its own — the handler re-checks permissions anyway.
function buildSpeakModal(channelId, channelName) {
  return new ModalBuilder()
    .setCustomId(`say:send:${channelId}`)
    .setTitle(channelName ? `Speak in ${channelName}`.slice(0, 45) : "Speak")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Message")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("say:body")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1800)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(SPEAK_HELP));
}

module.exports = { buildSpeakModal };
