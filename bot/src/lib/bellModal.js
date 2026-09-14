const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// The confirm on the Sound Bell button in the Cathedral's Bell Tower
// (db/lib/roomStarterRow.js). A modal, not a bare button, since one click is
// heard in four zones at once. The room id rides the customId so the submit
// handler can re-check where the ringer is standing, at submit, never at open.

const { RING_WORD, bellWordMatches } = require("@lifeweb/db/lib/bell");

const BELL_MODAL_PREFIX = "bell:ring:";
const BELL_WORD_FIELD = "bell:word";

const BELL_HELP = "-# The bell is heard throughout Ravenheart.";

function buildBellModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`${BELL_MODAL_PREFIX}${roomId}`)
    .setTitle("Sound the bell")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Type ${RING_WORD} to pull the rope`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(BELL_WORD_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(16)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(BELL_HELP));
}

module.exports = {
  BELL_MODAL_PREFIX,
  BELL_WORD_FIELD,
  RING_WORD,
  buildBellModal,
  bellWordMatches,
};
