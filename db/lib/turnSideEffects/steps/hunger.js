const { sendDm } = require("../../dm");
const { hungerDm, DYING_DM } = require("../../hungerPass");

async function sendHungerNotices({ prisma, p, eachDm }) {
  await eachDm("hunger", p.hungerNotices, async (notice) => {
    await sendDm(prisma, notice.discordUserId, hungerDm(notice)).catch((err) =>
      console.error(`Hunger DM to ${notice.discordUserId} failed:`, err),
    );
    if (notice.justDied) {
      await sendDm(prisma, notice.discordUserId, DYING_DM).catch((err) =>
        console.error(`Dying DM to ${notice.discordUserId} failed:`, err),
      );
    }
  });
}

module.exports = { sendHungerNotices };
