// Start the history over from the game being played now: every other Game row
// deleted, and the transcript emptied with them. Restart Game's own Discard
// button is the per-game version of this; this script takes the whole
// history at once. Keeps the CURRENT game (characters, tags, turns,
// factions, everything GameState points at), stripped of any ending
// (`endedAt`, `closingNote`, `epilogue`, `nukeDetonatedTurn`/
// `ascensionFiredTurn`). ArchiveEntry.gameId is a snapshot column, not a
// foreign key, so the transcript is deleted in the same pass rather than
// left orphaned.
//
// DESTRUCTIVE AND NOT UNDOABLE. Take a backup first (`npm run db:backup`).
// DRY RUN unless given `-- --apply`.
const { prisma, Prisma } = require("../../index");

async function main() {
  const apply = process.argv.includes("--apply");

  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    include: { game: true },
  });
  if (!state?.game) {
    console.error("No current Game to keep. Refusing to touch anything.");
    process.exitCode = 1;
    return;
  }

  const all = await prisma.game.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, exportKey: true } });
  const doomed = all.filter((g) => g.id !== state.game.id);
  const archives = await prisma.archiveEntry.count();

  console.log(`Current game: ${state.game.id} (phase ${state.phase})`);
  console.log(`  Game rows           : ${all.length} total, ${doomed.length} to delete`);
  console.log(`  Ids to delete       : ${doomed.map((g) => g.id).join(", ") || "(none)"}`);
  const packeted = doomed.filter((g) => g.exportKey); // packet stays in the bucket; only the pointer goes
  if (packeted.length) {
    console.log(`  Of those, with an archive packet in the bucket: ${packeted.length}`);
    for (const g of packeted) console.log(`    ${g.id} -> ${g.exportKey}`);
  }
  console.log(`  ArchiveEntry rows   : ${archives} to delete`);
  console.log(`  Clear the ending on ${state.game.id}:`);
  console.log(`    endedAt=${state.game.endedAt ?? "null"} closingNote=${state.game.closingNote ? "set" : "null"} epilogue=${state.game.epilogue ? "set" : "null"}`);
  console.log(`    nukeDetonatedTurn=${state.game.nukeDetonatedTurn ?? "null"} ascensionFiredTurn=${state.game.ascensionFiredTurn ?? "null"}`);
  console.log("  GameState: clear closingNote/endedAt and both countdowns; the phase is left alone");

  if (!apply) {
    console.log("\nDRY RUN. Nothing written. Re-run with -- --apply once a backup is in the bucket.");
    return;
  }

  await prisma.$transaction([
    prisma.archiveEntry.deleteMany({}),
    prisma.game.deleteMany({ where: { id: { not: state.game.id } } }),
    prisma.game.update({
      where: { id: state.game.id },
      data: {
        endedAt: null,
        closingNote: null,
        epilogue: Prisma.DbNull,
        nukeDetonatedTurn: null,
        ascensionFiredTurn: null,
      },
    }),
    prisma.gameState.update({
      where: { id: 1 },
      data: {
        closingNote: null,
        endedAt: null,
        // Phase deliberately NOT touched — forcing RUNNING would drop everyone
        // into a game with no lobby behind it. Countdown goes with the ending.
        nukeArmedTurn: null,
        nukeDetonatedTurn: null,
        ascensionArmedTurn: null,
        ascensionFiredTurn: null,
        ascensionLeaderCharacterId: null,
      },
    }),
  ]);

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: "system",
        actionType: "games_collapsed",
        details: { deleted: doomed.map((g) => g.id), archivesDeleted: archives, kept: state.game.id },
      },
    })
    .catch((err) => console.error("games_collapsed audit failed:", err));

  console.log("\nDone. One game, with nothing behind it and no ending on it.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
