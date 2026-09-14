// The Accept / Decline click on a consent DM (LESSONS.md). guild/member are
// null in a DM; the clicker is matched by Discord user id. The load, the
// ownership check and the order of the tail live in db/lib/dmAnswer.js
// (shared with the web's own twin, db/lib/dmActions.js) — this file keeps
// only what a gateway client can do and a REST one cannot: editing the
// interaction's own message, fetching a User to DM, and the room/carry syncs.
const { prisma } = require("@lifeweb/db");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { deliverCarryDrop } = require("@lifeweb/db/lib/carry");
const { syncCharacterRoomAccess } = require("@lifeweb/db/lib/roomAccess");
const { sendDm } = require("./dm");

async function settle(interaction, line) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({
      content: `${original}\n» ${line}`.slice(0, 2000),
      components: [],
    })
    .catch((err) => console.error("Offer button update failed:", err));
}

async function fanOut(interaction, dms) {
  for (const dm of dms ?? []) {
    const user = await interaction.client.users
      .fetch(dm.discordUserId)
      .catch(() => null);
    if (!user) continue;
    await sendDm(user, `» ${dm.content}`).catch((err) =>
      console.error(`Offer DM to ${dm.discordUserId} failed:`, err),
    );
  }
}

// The Discord half of what the router handed back. Best-effort: a failure
// here is the channel doctor's problem, not a reason to tell somebody the
// bind they accepted failed.
async function applySideEffects(interaction, sideEffects) {
  for (const characterId of sideEffects.roomSyncCharacterIds ?? []) {
    try {
      const row = await prisma.character.findUnique({ where: { id: characterId } });
      if (row) await syncCharacterRoomAccess(prisma, row);
    } catch (err) {
      console.error(`Post-bind room sync for ${characterId} failed:`, err);
    }
  }
  if (sideEffects.carryDrop) {
    await deliverCarryDrop(prisma, sideEffects.carryDrop).catch((err) =>
      console.error("Post-bind carry drop failed:", err),
    );
  }
  if (sideEffects.boundNotification) {
    await fanOut(interaction, [sideEffects.boundNotification]);
  }
}

async function handleOffer(interaction, offerId, choice) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.OFFER, id: offerId },
    choice,
    discordUserId: interaction.user.id,
  });
  await settle(interaction, result.line);
  await fanOut(interaction, result.dms);
  await applySideEffects(interaction, result.sideEffects);
}

async function handleOfferAccept(interaction, offerId) {
  await handleOffer(interaction, offerId, DM_CHOICE.ACCEPT);
}

async function handleOfferDecline(interaction, offerId) {
  await handleOffer(interaction, offerId, DM_CHOICE.DECLINE);
}

module.exports = { handleOfferAccept, handleOfferDecline };
