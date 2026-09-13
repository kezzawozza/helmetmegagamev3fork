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

// The dialogue behind a quest's Interact button (docs/systemdocs/QUESTS.md).
// A modal rather than a channel for the same reason the Move modal is one:
// typing in a channel fires the indicator under the player's real account.
//
// The QUEST id rides in the customId, not the room id, so the submit handler
// needs no thread-to-Room lookup and the quest can be re-checked directly. An
// ephemeral modal outlives somebody walking out of the cave, so permission is
// decided at submit, never at open.
//
// The prompt itself is INTERACT_PROMPT from db/lib/questText.js rather than a
// string typed here — the web dialog shows the same sentence, and a player
// who reads one on Discord and the other on the web must read the same words.

function buildQuestModal(questId, title) {
  return new ModalBuilder()
    .setCustomId(`${QUEST_MODAL_PREFIX}${questId}`)
    // Discord caps a modal title at 45, and the quest's own title is the most
    // useful thing to put there — it is what they clicked.
    .setTitle(String(title ?? "Interact").slice(0, 45))
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
