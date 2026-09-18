// The turn-close carry sweep (docs/systemdocs/CARRY.md), run from
// db/index.js#resolveNeeds() after the hunger pass so it sees the final
// sheet: mining payouts, staged pushes, the expiry sweep and the ⬢ upkeep
// charge all happen earlier in the close and none of them may settle in
// place (they run inside transactions, and a drop needs Discord).
//
// One settle per character, each its own transaction — a bad row must not
// roll back a hundred good ones. Returns the drops for runSideEffects rather
// than sending them. Takes `prisma` as a parameter — see db/lib/dm.js.
const { OVERBURDENED_SLUG } = require("./constants");
const { settleCarry } = require("./carry");
const { alivePassCharacters } = require("./aliveCharacters");

// Two clauses, where there used to be three. The third asked for anybody over
// the old ⬢ cap, read off GameConfig.carryResourceCap — and both that column
// and the cap behind it are gone: ⬢ are a tradeable one-pound item now, so a
// character holding a sack of them is already picked up by the first clause,
// same as one holding a sword. Nothing to port, so it went.
async function runCarryPass(prisma, turn) {
  const candidates = await alivePassCharacters(prisma, {
    where: {
      OR: [
        { tags: { some: { tag: { tradeable: true } } } },
        { tags: { some: { tag: { slug: OVERBURDENED_SLUG } } } },
      ],
    },
    select: { id: true },
  });

  let granted = 0;
  let removed = 0;
  const drops = [];
  const failed = [];
  for (const { id } of candidates) {
    const result = await settleCarry(prisma, id).catch((err) => {
      console.error(`Carry settle failed for ${id}:`, err);
      failed.push(id);
      return null;
    });
    if (!result) continue;
    if (result.granted) granted += 1;
    if (result.removed) removed += 1;
    if (result.drop) drops.push(result);
  }

  return {
    turnNumber: turn.number,
    settled: candidates.length,
    granted,
    removed,
    dropped: drops.length,
    failed,
    drops,
  };
}

module.exports = { runCarryPass };
