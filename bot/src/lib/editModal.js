// Editing a message you posted as your character, without typing into a DM.
// A reaction carries no interaction token, so a modal cannot open straight
// off ✏️. The path is: reaction → a DM carrying one button → the button click
// IS an interaction → modal, prefilled with the current text. Nothing the
// player writes ever travels as a DM message.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { editSpeech } = require("@lifeweb/db/lib/say");
const { proxyRowFor } = require("./proxy");
const { ack, respond } = require("./respond");

const OPEN_PREFIX = "edit:open:";
const MODAL_PREFIX = "edit:send:";
const BODY_ID = "edit:body";

const MESSAGE_LIMIT = 2000; // Discord's own ceiling; the TextInput could take 4000 but the edit would reject it

// Stashed when ✏️ is pressed rather than fetched at click time: showModal IS
// the acknowledgement (lib/respond.js), so it can't wait on a REST fetch.
// In memory and capped — a restart just opens the modal with an empty box.
const MAX_PENDING = 500;
const PENDING_TTL_MS = 15 * 60_000; // matches an interaction token's life
const pendingEdits = new Map(); // webhookMessageId -> { content, expiresAt }

function stashEdit(webhookMessageId, content) {
  pendingEdits.set(webhookMessageId, { content: content ?? "", expiresAt: Date.now() + PENDING_TTL_MS });
  if (pendingEdits.size > MAX_PENDING) {
    const oldest = pendingEdits.keys().next().value;
    pendingEdits.delete(oldest);
  }
}

function takeStashed(webhookMessageId) {
  const entry = pendingEdits.get(webhookMessageId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    pendingEdits.delete(webhookMessageId);
    return null;
  }
  return entry.content;
}

// The DM the ✏️ reaction sends, carrying the message id.
function buildEditPrompt(webhookMessageId) {
  return {
    content: "» *Edit that message.*",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${OPEN_PREFIX}${webhookMessageId}`)
          .setLabel("Edit text")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildEditModal(webhookMessageId, currentContent) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${webhookMessageId}`)
    .setTitle("Edit message")
    .addLabelComponents(
      new LabelBuilder().setLabel("Message").setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(BODY_ID)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MESSAGE_LIMIT)
          .setRequired(true)
          .setValue((currentContent ?? "").slice(0, MESSAGE_LIMIT)),
      ),
    );
}

// Resolves the archived row a button/modal id points at, and checks the
// presser owns it — interaction.user.id against the row's own player.
async function resolveOwnedProxy(interaction, prefix) {
  const messageId = interaction.customId.slice(prefix.length);
  const proxy = await proxyRowFor(messageId);
  if (!proxy || proxy.deletedAt || proxy.discordUserId !== interaction.user.id) {
    return { messageId, proxy: null };
  }
  return { messageId, proxy };
}

// NO ack() here on purpose: showModal is the acknowledgement, and a deferred
// interaction can no longer open a modal.
async function handleEditOpen(interaction) {
  const { messageId, proxy } = await resolveOwnedProxy(interaction, OPEN_PREFIX);
  if (!proxy) {
    await ack(interaction);
    await respond(interaction, "That message can no longer be edited.");
    return;
  }
  await interaction.showModal(buildEditModal(messageId, takeStashed(messageId) ?? proxy.content));
}

async function handleEditSubmit(interaction) {
  await ack(interaction);

  const { messageId, proxy } = await resolveOwnedProxy(interaction, MODAL_PREFIX);
  if (!proxy) {
    await respond(interaction, "That message can no longer be edited.");
    return;
  }

  const content = interaction.fields.getTextInputValue(BODY_ID);

  // The ROW is edited; the outbox (feedOutbox.js) carries the change across,
  // the five-minute window enforced in one place (db/lib/say.js).
  const result = await editSpeech(prisma, { characterId: proxy.characterId, seq: proxy.seq, content });
  if (!result?.ok) {
    await respond(interaction, `${result?.refusal ?? "Couldn't update that message."}`);
    return;
  }

  stashEdit(messageId, result.row.content);
  await respond(interaction, "Updated.");
}

module.exports = {
  OPEN_PREFIX,
  MODAL_PREFIX,
  buildEditPrompt,
  stashEdit,
  handleEditOpen,
  handleEditSubmit,
};
