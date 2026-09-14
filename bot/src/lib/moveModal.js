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
// in the TextDisplay below. Labor shares the radio group with Routine and
// Gambit since it's the same slot; filing nothing picks Labor for you
// (db/lib/autoLaborPass.js).
const MOVE_HELP =
  "-# Describe what you're hoping to accomplish — in the broadest sense, the ideal outcome, your intent. " +
  "Mention relevant tags or circumstances that the GMs should consider. " +
  "Labor needs no arbitration: it pays your best Laboring skill for where you're standing. " +
  "Careful! This can't be changed or canceled.";

function buildMoveModal() {
  return new ModalBuilder()
    .setCustomId(MOVE_MODAL_ID)
    .setTitle("Lock In Your Move")
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
              { label: "Routine", value: "ROUTINE", description: "Easy — it resolves itself." },
              { label: "Gambit", value: "GAMBIT", description: "Could go either way — rolls a die." },
              { label: "Labor", value: "LABOR", description: "Work the day using your best Labor skill." },
            ),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(MOVE_HELP));
}

module.exports = { buildMoveModal };
