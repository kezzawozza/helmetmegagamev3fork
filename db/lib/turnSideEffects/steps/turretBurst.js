const { announceTurretBurst } = require("../../turretBurst");

// Before the DMs below rather than after, so the zone hears the burst about when the people it hit are told what it did to them.
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
