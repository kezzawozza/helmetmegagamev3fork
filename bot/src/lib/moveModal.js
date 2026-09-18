const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// The whole Move, in one popup. Needs discord.js >= 14.27 for Label (18)
// wrapping a TextInput (4), plus a bare TextDisplay (10) for the `-#` line —
// older builders silently produce a payload Discord rejects. A modal must show
// within 3 seconds and cannot be deferred first, so nothing here reads the
// database; gates all run on submit
// (bot/src/events/interactionCreate.js#handleMoveSubmit).

const MOVE_MODAL_ID = "move:new";

// Kept word-for-word in step with web/app/(app)/chat/MoveDialog.js. If the
// wording changes, change it in both places.
const MOVE_HELP =
  "-# Describe what you're hoping to accomplish — in the broadest sense, the ideal outcome and your intent. " +
  "Mention relevant tags or circumstances that the GMs should consider.";

function buildMoveModal() {
  return new ModalBuilder()
    .setCustomId(MOVE_MODAL_ID)
    .setTitle("Declare your move")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Your Move")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("move:body")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1800)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(MOVE_HELP));
}

module.exports = { buildMoveModal };
