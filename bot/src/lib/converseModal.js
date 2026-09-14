const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

// A modal must show within 3s and cannot be deferred first, so nothing here reads the database;
// every gate runs on submit (interactionCreate.js).

const CONVERSE_MODAL_PREFIX = "conv:new:";
const CONVERSE_NAME_FIELD = "conv:name";

function buildConverseModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`${CONVERSE_MODAL_PREFIX}${roomId}`)
    .setTitle("Start a conversation")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Name")
        .setDescription("What this conversation is about. Everyone you invite sees it.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(CONVERSE_NAME_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(90)
            .setRequired(true),
        ),
    );
}

module.exports = { buildConverseModal, CONVERSE_MODAL_PREFIX, CONVERSE_NAME_FIELD };
