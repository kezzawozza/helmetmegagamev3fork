// This game's Words of the Circle, rolled once and kept on GameState (docs/systemdocs/THANATI.md). Lazy: the first reader rolls them. Takes `db` as a parameter, the db/lib/dm.js convention, and is not on the barrel.
const { Prisma } = require("@prisma/client");
const { RITES, rollRiteWords } = require("./rites");
const { readGameState } = require("./gameState");

// A READ first — this runs on every line of chat, and an upsert would take a write lock on GameState for each one.
async function ensureRiteWords(db) {
  const state = await readGameState(db, { riteWords: true });
  const stored = state?.riteWords && typeof state.riteWords === "object" ? state.riteWords : null;
  if (stored) {
    const missing = RITES.filter((rite) => typeof stored[rite.key] !== "string" || !stored[rite.key].trim());
    if (missing.length === 0) return stored;
    const topped = rollRiteWords(Math.random, RITES, stored);
    await db.gameState.updateMany({
      where: { id: 1, riteWords: { equals: stored } },
      data: { riteWords: topped },
    });
    const after = await db.gameState.findUnique({ where: { id: 1 }, select: { riteWords: true } });
    return after?.riteWords ?? topped;
  }

  // Guarded write: two first readers racing here both roll, and only the one that finds the column still null lands.
  await db.gameState.updateMany({
    where: { id: 1, riteWords: { equals: Prisma.DbNull } },
    data: { riteWords: rollRiteWords() },
  });
  const after = await db.gameState.findUnique({ where: { id: 1 }, select: { riteWords: true } });
  return after?.riteWords ?? {};
}

module.exports = { ensureRiteWords };
