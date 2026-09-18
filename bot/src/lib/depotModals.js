const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

// One modal shape, used by the ATM and the drop box: a number, and nothing
// else. Both are "you are standing at the machine with your phone out" — the
// comparing and the re-pointing live on /depot.
//
// Deliberately NOT validated here. What counts as an amount is a fact about a
// balance and a pocket, which is db/lib/depotCounter.js's to decide and to
// refuse in words the web says too.
function buildAmountModal({ customId, field, title, label }) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(label)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(field)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(8)
            .setRequired(true),
        ),
    );
}

module.exports = { buildAmountModal };
