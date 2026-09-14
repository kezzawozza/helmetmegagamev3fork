const { plainDm } = require("../shared");

async function sendTurretAndBirdDms({ prisma, p, eachDm }) {
  await eachDm("turretDm", p.turretDms, (dm) => plainDm(prisma, dm, "Turret"));
  await eachDm("bird", p.birdNotices, (dm) => plainDm(prisma, dm, "Bird failure"));
}

module.exports = { sendTurretAndBirdDms };
