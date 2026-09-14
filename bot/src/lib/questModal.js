const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

const {
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  INTERACT_PROMPT,
  INTENTION_MAX,
} = require("@lifeweb/db/lib/questText");

// The dialogue behind a quest's Interact button (QUESTS.md). A modal, same
// reason as the Move modal: typing in a channel fires the indicator under the
// player's real account. The QUEST id rides in the customId, not the room id,
// so the quest can be re-checked directly at submit, never at open. The
// prompt is INTERACT_PROMPT from db/lib/questText.js so Discord and the web
// dialog show the same sentence.

function buildQuestModal(questId, title) {
  return new ModalBuilder()
    .setCustomId(`${QUEST_MODAL_PREFIX}${questId}`)
    .setTitle(String(title ?? "Interact").slice(0, 45)) // Discord caps a modal title at 45
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${INTERACT_PROMPT}`))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Your intentions")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(QUEST_INTENTION_FIELD)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(INTENTION_MAX)
            .setRequired(true),
        ),
    );
}

module.exports = { buildQuestModal };
