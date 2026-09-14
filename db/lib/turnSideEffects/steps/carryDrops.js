const { deliverCarryDrop } = require("../../carry");

async function deliverCarryDrops({ prisma, p, list, step }) {
  const carryDrops = list(p.carryDrops);
  for (let i = 0; i < carryDrops.length; i += 1) {
    const result = carryDrops[i];
    await step(`carryDrop:${i}`, () =>
      deliverCarryDrop(prisma, result).catch((err) =>
        console.error(`Carry drop delivery for ${result.characterId} failed:`, err),
      ),
    );
  }
}

module.exports = { deliverCarryDrops };
