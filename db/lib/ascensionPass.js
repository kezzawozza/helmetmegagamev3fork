// Ravenheart burns. The Rite of Ascension's other half, and the second way a
// game can end (docs/systemdocs/THANATI.md §9, docs/systemdocs/LOBBY.md §7).
//
// ORDERING IS LOAD-BEARING, for the reason nukeExplosionPass.js gives and one
// more of its own. It must run AFTER the staged push and tagExpiry, because
// the one thing that calls this off is the cult leader dying — and a killing
// adjudicated this turn has to beat the clock. If this ran first, a town that
// stormed the hideout and won would still burn.
//
// WHO DIES: EVERYONE. Every ALIVE character, with no zone exemption at all —
// which is the one line that separates this ending from the bomb's. The nuke
// spares the two cave levels, because being under the rock is the whole
// escape; here the rock is what Ravenheart is swallowed into, so there is
// nowhere to have been. Gibbed, like the blast: nothing is left to loot, bury
// or butcher afterwards, and there is no afterwards.
//
// DB writes only. The Discord fan-out comes back as `broadcast` and `deaths`
// for the
// side-effect thunk, the catatonicDeathPass.js contract — a pass that posts
// inside the turn transaction is a pass that wedges a turn on a 429.
//
// Takes `prisma` as a parameter — see db/lib/dm.js.
const { applyDeathToRow } = require("./characterDeath");
const { alivePassCharacters } = require("./aliveCharacters");

// What every #summary reads, verbatim from Bascinet. No @everyone: the warning
// two turns ago was the one worth waking somebody for, and by the time this
// posts there is nothing left to do about it.
const ASCENSION_LINE = "Ravenheart is consumed by ravenous hellfire and swallowed into the earth.";

// What each victim is told. Without a `reason` the shared death-DM loop in
// db/index.js interpolates it anyway, and everybody gets "You have died.
// undefined" — the bug db/lib/nukeExplosionPass.js records having shipped once
// already.
const ASCENSION_DEATH_REASON =
  "the hellfire took Ravenheart and everything standing in it.";

const IDLE = Object.freeze({ fired: false, cancelled: false, deaths: [], broadcast: null });

async function runAscensionPass(prisma, turn) {
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    include: { game: { select: { id: true, ascensionFiredTurn: true } } },
  });

  // Not armed, or armed for a turn that has not come yet. Returning an object
  // rather than null matters: null means "did not run, retry forever" and
  // would wedge every turn from here on.
  const armedTurn = state?.ascensionArmedTurn ?? null;
  if (armedTurn == null || armedTurn > turn.number) return { turnNumber: turn.number, ...IDLE };

  // Already happened IN THIS GAME. Read off the Game row rather than
  // GameState, the reason db/lib/nukeExplosionPass.js gives: turn numbers
  // restart every game, so the GameState stamp could not tell a fresh game
  // from the one that burned.
  if (state?.game?.ascensionFiredTurn != null) return { turnNumber: turn.number, ...IDLE };

  // "It stops ONLY if the cult leader is killed." A dangling id — the row
  // deleted by a Restart, or no leader recorded at all — reads as gone, which
  // cancels, which is the safe direction.
  const leaderId = state?.ascensionLeaderCharacterId ?? null;
  const leader = leaderId
    ? await prisma.character.findUnique({ where: { id: leaderId }, select: { id: true, name: true, status: true } })
    : null;
  if (!leader || leader.status !== "ALIVE") {
    await prisma.gameState.update({ where: { id: 1 }, data: { ascensionArmedTurn: null } });
    return {
      turnNumber: turn.number,
      fired: false,
      cancelled: true,
      leader: leader?.name ?? null,
      deaths: [],
      broadcast: null,
    };
  }

  // Claim it before anything else, the bomb's rule: a crash halfway through
  // cannot leave a world that burns again on the next close.
  await prisma.gameState.update({
    where: { id: 1 },
    data: { ascensionFiredTurn: turn.number, ascensionArmedTurn: null },
  });
  if (state?.game?.id) {
    await prisma.game.update({
      where: { id: state.game.id },
      data: { ascensionFiredTurn: turn.number },
    });
  }

  const doomed = await alivePassCharacters(prisma, {
    select: {
      id: true,
      name: true,
      discordUserId: true,
      discordRoleId: true,
      zoneId: true,
    },
  });

  const deaths = [];
  for (const character of doomed) {
    // Sequential, never Promise.all, and gibbed — the bomb's rule and for the
    // bomb's reasons (db/lib/nukeExplosionPass.js). The conditional claim
    // inside applyDeathToRow is what stops a resumed turn killing twice.
    const { claimed } = await applyDeathToRow(prisma, character, {
      turn,
      gib: true,
      content: `${character.name} burned with Ravenheart.`,
    });
    if (!claimed) continue;
    deaths.push({
      characterId: character.id,
      name: character.name,
      discordUserId: character.discordUserId,
      // Captured before applyDeathToRow nulls it — the thunk still owes
      // Discord this role's deletion.
      discordRoleId: character.discordRoleId,
      zoneId: character.zoneId,
      reason: ASCENSION_DEATH_REASON,
    });
  }

  return {
    turnNumber: turn.number,
    fired: true,
    cancelled: false,
    leader: leader.name,
    gameId: state?.game?.id ?? null,
    killed: deaths.length,
    deaths,
    broadcast: { content: ASCENSION_LINE },
  };
}

module.exports = { runAscensionPass, ASCENSION_LINE, ASCENSION_DEATH_REASON };
