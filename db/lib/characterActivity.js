// Debounced writer for Character.lastActivityTurn, the clock db/lib/catatonicPass.js reads. Looks up
// the open turn itself, so a chatty player costs one UPDATE per turn, not one per message. Called only
// from things that mean "a real person did something this turn" — never from db/lib/autoLaborPass.js,
// whose auto-filed Default Effort would otherwise mean nobody could ever go Catatonic.
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
async function touchCharacterActivity(prisma, characterId) {
  if (!characterId) return;
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  if (!openTurn) return; // between turns; the next activity after open catches up
  await prisma.character
    .updateMany({
      // The OR is load-bearing: Prisma's `not: N` compiles to SQL `<>`, NULL-false, so the guard alone
      // silently excludes every character whose clock was never stamped.
      where: {
        id: characterId,
        OR: [{ lastActivityTurn: null }, { lastActivityTurn: { not: openTurn.number } }],
      },
      data: { lastActivityTurn: openTurn.number },
    })
    .catch((err) => console.error(`touchCharacterActivity failed for ${characterId}:`, err));
}

module.exports = { touchCharacterActivity };
