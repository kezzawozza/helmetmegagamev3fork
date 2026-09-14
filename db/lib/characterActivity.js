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

// Five minutes: comfortably under the hour ONLINE_WINDOW_MS (db/lib/whosHere.js)
// reads it against, so nobody's badge goes stale-looking between writes.
const LAST_SEEN_DEBOUNCE_MS = 5 * 60_000;

// Debounced writer for Character.lastSeenAt, the "online" badge's clock —
// a different grain from touchCharacterActivity above (minutes, not turns).
// Called from ANY authenticated web page view (web/app/(app)/layout.js) and
// from a proxied Discord message (bot/src/lib/proxy.js#sendAsCharacter), so
// "used the website or sent a message" is one write path either way. Keyed
// on discordUserId rather than a characterId, so the web caller (which has
// no character loaded, only the session) needs no extra lookup — one
// conditional updateMany either way.
async function touchLastSeen(prisma, discordUserId) {
  if (!discordUserId) return;
  const staleBefore = new Date(Date.now() - LAST_SEEN_DEBOUNCE_MS);
  await prisma.character
    .updateMany({
      // The OR is load-bearing for the same reason touchCharacterActivity's
      // is: `lt: staleBefore` alone never matches a NULL lastSeenAt.
      where: {
        discordUserId,
        status: "ALIVE",
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }],
      },
      data: { lastSeenAt: new Date() },
    })
    .catch((err) => console.error(`touchLastSeen failed for ${discordUserId}:`, err));
}

module.exports = { touchCharacterActivity, touchLastSeen };
