// The Refuse and Partial clicks on a tax DM (docs/tags.yaml's `taxman`
// description). guild/member are null in a DM; the clicker is matched by
// Discord user id in db/lib/tax.js. The load, ownership check and answer
// live in db/lib/dmAnswer.js — this file keeps only the modal and editing
// the interaction's own message. No fan-out.
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");

const TAX_PARTIAL_MODAL_PREFIX = "tax-partial-modal:";
const TAX_PARTIAL_FIELD = "tax-partial:amount";

async function finish(interaction, result) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({
      content: `${original}\n» ${result.line}`.slice(0, 2000),
      components: [],
    })
    .catch((err) => console.error("Tax button update failed:", err));
}

async function handleTaxDecline(interaction, pendingTaxId) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.PENDING_TAX, id: pendingTaxId },
    discordUserId: interaction.user.id,
  });
  await finish(interaction, result);
}

async function handleTaxPartialOpen(interaction, pendingTaxId) {
  const row = await prisma.pendingTax
    .findUnique({ where: { id: pendingTaxId }, select: { amount: true } })
    .catch(() => null);
  const input = new TextInputBuilder()
    .setCustomId(TAX_PARTIAL_FIELD)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(6)
    .setRequired(true);
  if (row) input.setPlaceholder(`0–${row.amount}`);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${TAX_PARTIAL_MODAL_PREFIX}${pendingTaxId}`)
      .setTitle("Partial")
      .addLabelComponents(
        new LabelBuilder().setLabel("How much do you want to pay instead?").setTextInputComponent(input),
      ),
  );
}

async function handleTaxPartialSubmit(interaction, pendingTaxId) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.PENDING_TAX, id: pendingTaxId },
    choice: DM_CHOICE.PARTIAL,
    amount: interaction.fields.getTextInputValue(TAX_PARTIAL_FIELD),
    discordUserId: interaction.user.id,
  });
  if (!result.ok && result.line === "Enter a number.") { // leaves the buttons up so they can try again
    return void (await interaction.reply({ content: `» *${result.line}*`, flags: 64 }).catch(() => {}));
  }
  await finish(interaction, result);
}

module.exports = { TAX_PARTIAL_MODAL_PREFIX, handleTaxDecline, handleTaxPartialOpen, handleTaxPartialSubmit };
