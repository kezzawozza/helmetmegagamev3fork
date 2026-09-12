const { prisma } = require("@lifeweb/db");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { BIRD_REPLY_PICK_PREFIX } = require("@lifeweb/db/lib/bird");
const { birdReplyWindow, sendableLetters, sendBirdReply } = require("@lifeweb/db/lib/birdReply");
const { ack, respond } = require("./respond");

// The Reply button on a Bird's letter, and the picker it opens — Discord's
// half only. Every rule (the window, literacy, the one-reply claim, what a
// sealed answer shows) lives in db/lib/birdReply.js, shared with the web's
// Reply dialog so the two faces cannot refuse different things. See
// docs/systemdocs/BIRD.md.
//
// This runs in a DM, so there is no guild and no member — nothing here may
// touch interaction.guild or interaction.member. It doesn't need to: the
// BirdMessage row carries both parties as snapshots, and the button only ever
// exists on the recipient's own DM, which is why no acting character is passed
// to the core. The web, being a public endpoint, does pass one.

// Discord's cap on a string select's options.
const OPTION_LIMIT = 25;

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

  // The core re-checks the window on the pick, not just on the open: the panel
  // can sit on screen across a turn boundary.
  const result = await sendBirdReply(prisma, birdMessageId, tagId);
  if (!result.ok) return respond(interaction, { content: result.reason });

  // Returned rather than sent by the core, so the web can send it through its
  // own transport (ARCHITECTURE.md §5). Null for a GM letter.
  if (result.dm) {
    await sendDm(prisma, result.dm.discordUserId, result.dm.content, result.dm.opts).catch((err) =>
      console.error(`Bird reply DM to ${result.dm.discordUserId} failed:`, err),
    );
  }

  return respond(interaction, { content: result.line });
}

module.exports = { handleBirdReplyOpen, handleBirdReplyPick };
