const { sendDm } = require("../../dm");
const { plainDm } = require("../shared");

async function sendEarlyDmNotices({ prisma, p, eachDm }) {
  await eachDm("lesson", p.lessonDms, (dm) => plainDm(prisma, dm, "Lesson"));
  await eachDm("research", p.researchDms, (dm) => plainDm(prisma, dm, "Research"));
  await eachDm("confession", p.confessionDms, (dm) => plainDm(prisma, dm, "Confession"));
  await eachDm("trinket", p.trinketDms, (dm) => plainDm(prisma, dm, "Trinket"));
  await eachDm("tagExpiry", p.tagExpiryDms, (dm) => plainDm(prisma, dm, "Tag progression"));
}

async function sendLateDmNotices({ prisma, p, eachDm }) {
  await eachDm("routine", p.routineNotices, (notice) =>
    sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
      console.error(`Passed-Routine DM to ${notice.discordUserId} failed:`, err),
    ),
  );

  await eachDm("gambit", p.gambitRollNotices, (notice) =>
    sendDm(prisma, notice.discordUserId, notice.content).catch((err) =>
      console.error(`Gambit roll DM to ${notice.discordUserId} failed:`, err),
    ),
  );
}

module.exports = { sendEarlyDmNotices, sendLateDmNotices };
