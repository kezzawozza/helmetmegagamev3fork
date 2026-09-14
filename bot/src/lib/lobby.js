// The Decline click on an assignment DM (LOBBY.md §4). guild/member are null
// in a DM; the clicker is matched by Discord user id in db/lib/lobby.js.
const { prisma } = require("@lifeweb/db");
const { declineAssignment } = require("@lifeweb/db/lib/lobby");

async function handleLobbyDecline(interaction, entryId) {
  const result = await declineAssignment(prisma, entryId, interaction.user.id);
  const original = interaction.message?.content ?? "";
  await interaction
    .update({ content: `${original}\n» ${result.ok ? result.line : result.reason}`.slice(0, 2000), components: [] })
    .catch((err) => console.error("Lobby decline button update failed:", err));
}

module.exports = { handleLobbyDecline };
