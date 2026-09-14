const { prisma } = require("@lifeweb/db");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { BIRD_REPLY_PICK_PREFIX } = require("@lifeweb/db/lib/bird");
const { birdReplyWindow, sendableLetters, sendBirdReply } = require("@lifeweb/db/lib/birdReply");
const { ack, respond } = require("./respond");

// The Reply button on a Bird's letter, and the picker it opens — Discord's
// half only. Every rule lives in db/lib/birdReply.js, shared with the web's
// Reply dialog (BIRD.md). Runs in a DM, so no guild/member; the BirdMessage
// row carries both parties as snapshots, so no acting character is passed to
// the core (the web, a public endpoint, does pass one).

const OPTION_LIMIT = 25; // Discord's cap on a string select's options

async function handleBirdReplyOpen(interaction, birdMessageId) {
  await ack(interaction, { ephemeral: true });

  const state = await birdReplyWindow(prisma, birdMessageId);
  if (!state.ok) return respond(interaction, { content: state.reason });

  const letters = sendableLetters(state.replier, { limit: OPTION_LIMIT });
  if (letters.length === 0) {
    return respond(interaction, {
      content:
        "You have nothing written to send back. Write a letter on your sheet, then answer before the bird goes.",
    });
  }

  return respond(interaction, {
    content: `The bird waits for something to carry back to **${state.message.senderName}**. It will not wait past next turn.`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${BIRD_REPLY_PICK_PREFIX}${birdMessageId}`,
            placeholder: "Which letter?",
            options: letters.map((ct) => ({
              label: ct.tag.name.slice(0, 100),
              value: ct.tagId,
              description: ct.tag.paperKind === "SEALED" ? "Sealed" : undefined,
            })),
          },
        ],
      },
    ],
  });
}

async function handleBirdReplyPick(interaction, birdMessageId) {
  await ack(interaction, { ephemeral: true });

  const tagId = interaction.values?.[0];
  if (!tagId) return respond(interaction, { content: "Nothing picked." });

  const result = await sendBirdReply(prisma, birdMessageId, tagId);
  if (!result.ok) return respond(interaction, { content: result.reason });

  if (result.dm) { // returned rather than sent, so the web can use its own transport (ARCHITECTURE.md §5)
    await sendDm(prisma, result.dm.discordUserId, result.dm.content, result.dm.opts).catch((err) =>
      console.error(`Bird reply DM to ${result.dm.discordUserId} failed:`, err),
    );
  }

  return respond(interaction, { content: result.line });
}

module.exports = { handleBirdReplyOpen, handleBirdReplyPick };
