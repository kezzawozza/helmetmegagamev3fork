const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// The PA, composed in a modal off the Intercom button on the Council Room's
// starter post (db/lib/roomStarterRow.js). The room id rides in the customId
// so the submit handler can re-check where the speaker is standing at submit,
// never at open.

const INTERCOM_MODAL_PREFIX = "intercom:send:";
const INTERCOM_MAX_LENGTH = 1200; // well under Discord's cap; chunking would ping @here per chunk

const INTERCOM_HELP = "-# Heard everywhere except in the Black Hills and the caves.";

function buildIntercomModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`${INTERCOM_MODAL_PREFIX}${roomId}`)
    .setTitle("Intercom")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Announcement")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("intercom:body")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(INTERCOM_MAX_LENGTH)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(INTERCOM_HELP));
}

module.exports = {
  INTERCOM_MODAL_PREFIX,
  buildIntercomModal,
};
