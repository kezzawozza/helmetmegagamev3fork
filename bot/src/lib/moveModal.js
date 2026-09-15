const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
  RadioGroupBuilder,
} = require("discord.js");

// The whole Move, in one popup. Needs discord.js >= 14.27 for Label (18)
// wrapping a TextInput (4) and a RadioGroup (21), plus a bare TextDisplay
// (10) for the `-#` line — older builders silently produce a payload
// Discord rejects. A modal must show within 3 seconds and cannot be deferred
// first, so nothing here reads the database; gates all run on submit
// (bot/src/events/interactionCreate.js#handleMoveSubmit).

const MOVE_MODAL_ID = "move:new";

// Label.description caps at 100 characters, so the full guidance line lives
// in the TextDisplay below. Two kinds now, not three: Routine stopped being
// something a player picks and became what the game calls a Move you didn't
// write (db/lib/moves.js#PLAYER_MOVE_KINDS). Filing nothing picks Labor for
// you (db/lib/autoLaborPass.js).
// Kept word-for-word in step with web/app/(app)/chat/MoveDialog.js's
// MOVE_KINDS. If the wording changes, change it in both places.
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
      new LabelBuilder()
        .setLabel("Kind")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId("move:kind")
            .setRequired(true)
            .addOptions(
              { label: "Gambit", value: "GAMBIT", description: "An action affected by chance." },
              { label: "Labor", value: "LABOR", description: "Produce resources using your best laboring skill." },
            ),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(MOVE_HELP));
}

module.exports = { buildMoveModal };
