const { announceTurretBurst } = require("../../turretBurst");

// A gun going off is heard well past the room it is in. Before the DMs
// below rather than after, so the zone hears the burst at about the moment
// the people it hit are told what it did to them.
async function announceTurretBursts({ prisma, p, list, step }) {
  const turretBursts = list(p.turretBursts);
  for (let i = 0; i < turretBursts.length; i += 1) {
    const burstLocationId = turretBursts[i];
    await step(`turretBurst:${i}`, () =>
      announceTurretBurst(prisma, burstLocationId).catch((err) =>
        console.error("Turret burst failed:", err.message ?? err),
      ),
    );
  }
}

module.exports = { announceTurretBursts };
