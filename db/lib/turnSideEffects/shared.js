// Helpers shared by more than one turn-side-effect step module.
const { sendDm } = require("../dm");

const plainDm = (prisma, dm, label) => (
  sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
    console.error(`${label} DM to ${dm.discordUserId} failed:`, err),
  )
);

module.exports = { plainDm };
