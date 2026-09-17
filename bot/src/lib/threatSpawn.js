// The Accept / Decline click on a threat spawn offer (THREATS.md). guild/
// member are null in a DM; the clicker is matched by Discord user id inside
// db/lib/threatSpawn.js. Same shape as bot/src/lib/offers.js — this file only
// routes. The brief, audit row and archive entry live in db/lib/dmAnswer.js
// (shared with the web's db/lib/dmActions.js); this keeps only what's
// gateway-only: editing the message.
const { prisma } = require("@lifeweb/db");
const { answerDmAction } = require("@lifeweb/db/lib/dmAnswer");
const { DM_ACTION, DM_CHOICE } = require("@lifeweb/db/lib/dmActions");
const { applySpawnSideEffects } = require("@lifeweb/db/lib/threatSpawn");
const { sendDm } = require("./dm");

async function settle(interaction, line) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({ content: `${original}\n» ${line}`.slice(0, 2000), components: [] })
    .catch((err) => console.error("Threat spawn button update failed:", err));
}

async function handleSpawn(interaction, spawnId, choice) {
  const result = await answerDmAction(prisma, {
    action: { kind: DM_ACTION.THREAT_SPAWN, id: spawnId },
    choice,
    discordUserId: interaction.user.id,
  });

  await settle(interaction, result.line);
  if (!result.ok) return;

  for (const dm of result.dms ?? []) {
    await sendDm(interaction.user, `» ${dm.content}`).catch((err) =>
      console.error("Threat spawn brief DM failed:", err),
    );
  }

  if (result.sideEffects.spawn) {
    await applySpawnSideEffects(prisma, result.sideEffects.spawn).catch((err) =>
      console.error("Threat spawn side effects failed:", err),
    );
  }
}

async function handleThreatSpawnAccept(interaction, spawnId) {
  await handleSpawn(interaction, spawnId, DM_CHOICE.ACCEPT);
}

async function handleThreatSpawnDecline(interaction, spawnId) {
  await handleSpawn(interaction, spawnId, DM_CHOICE.DECLINE);
}

module.exports = { handleThreatSpawnAccept, handleThreatSpawnDecline };
