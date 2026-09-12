// Builds the per-turn rollup /gm/economy's charts read.
//
// A CACHE, not a source of truth. Every row here is derivable from
// EconomyEntry, and rebuild() throws the lot away and recomputes it — which is
// what the Health section's rebuild button calls. Nothing may ever read the
// rollup for a number it could not get from the ledger.
//
// It exists because a month-long game with 100+ players makes the ledger the
// longest table in the database, and the Pulse chart wants one row per turn,
// not a scan of all of it.
//
// Takes `prisma` as a parameter, the db/lib/dm.js convention.

// The grain. fromKind/toKind are in it because a mint (one end in a world
// account) and a hand-over between two players are the same reason wearing
// different shapes, and the supply chart has to tell them apart.
const GRAIN = ["turnNumber", "reason", "form", "fromKind", "toKind"];

async function buildTurn(prisma, gameId, turnNumber) {
  const grouped = await prisma.economyEntry.groupBy({
    by: GRAIN,
    where: { gameId, turnNumber },
    _sum: { amount: true },
    _count: { _all: true },
  });

  // Replace rather than upsert: a turn re-resolved after a GM repair can have
  // FEWER buckets than before, and an upsert would leave the vanished ones
  // behind as ghosts that no entry backs any more.
  await prisma.$transaction([
    prisma.economyTurnRollup.deleteMany({ where: { gameId, turnNumber } }),
    ...(grouped.length
      ? [
          prisma.economyTurnRollup.createMany({
            data: grouped.map((g) => ({
              gameId,
              turnNumber,
              reason: g.reason,
              form: g.form,
              fromKind: g.fromKind,
              toKind: g.toKind,
              amount: g._sum.amount ?? 0,
              entryCount: g._count._all,
            })),
          }),
        ]
      : []),
  ]);

  return grouped.length;
}

// Every turn that has entries. Used by the rebuild button and by a fresh
// install that has just backfilled.
async function rebuild(prisma, gameId) {
  const turns = await prisma.economyEntry.groupBy({ by: ["turnNumber"], where: { gameId } });
  let buckets = 0;
  for (const t of turns) {
    if (t.turnNumber == null) continue;
    buckets += await buildTurn(prisma, gameId, t.turnNumber);
  }
  return { turns: turns.length, buckets };
}

module.exports = { buildTurn, rebuild };
