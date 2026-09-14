// Ravenheart burns — the Rite of Ascension's other half, and the second way a game can end
// (docs/systemdocs/THANATI.md §9, docs/systemdocs/LOBBY.md §7). Ordering is load-bearing (reason
// nukeExplosionPass.js gives, plus one more): must run AFTER the staged push and tagExpiry, since only
// the cult leader dying calls it off, and a killing adjudicated this turn has to beat the clock — run
// first and a town that stormed and won the hideout would still burn. WHO DIES: everyone ALIVE, with
// no zone exemption (unlike the nuke, which spares the cave levels) — gibbed, nothing left to loot,
// bury or butcher. DB writes only; the Discord fan-out returns as `broadcast`/`deaths` for the side-
// effect thunk (catatonicDeathPass.js contract — posting inside the turn transaction risks wedging a
// turn on a 429). Takes `prisma` as a parameter — see db/lib/dm.js.
const { applyDeathToRow } = require("./characterDeath");
const { alivePassCharacters } = require("./aliveCharacters");

// What every #summary reads, verbatim from Bascinet. No @everyone — the warning two turns ago was
// worth waking somebody for; by now there's nothing left to do about it.
const ASCENSION_LINE = "Ravenheart is consumed by ravenous hellfire and swallowed into the earth.";

// Without a `reason` the shared death-DM loop in db/index.js interpolates it anyway, giving "You have
// died. undefined" — shipped once already (db/lib/nukeExplosionPass.js).
const ASCENSION_DEATH_REASON =
  "the hellfire took Ravenheart and everything standing in it.";

const IDLE = Object.freeze({ fired: false, cancelled: false, deaths: [], broadcast: null });

async function runAscensionPass(prisma, turn) {
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    include: { game: { select: { id: true, ascensionFiredTurn: true } } },
  });

  // Not armed, or armed for a future turn. Return an object, not null — null means "retry forever"
  // and would wedge every turn from here on.
  const armedTurn = state?.ascensionArmedTurn ?? null;
  if (armedTurn == null || armedTurn > turn.number) return { turnNumber: turn.number, ...IDLE };

  // Already happened in THIS game — read off Game, not GameState, since turn numbers restart every
  // game and the GameState stamp can't tell a fresh game from the one that burned.
  if (state?.game?.ascensionFiredTurn != null) return { turnNumber: turn.number, ...IDLE };

  // Stops ONLY if the cult leader is killed; a dangling id (Restart-deleted row, or none recorded)
  // reads as gone, which cancels — the safe direction.
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

  // Claim it before anything else (the bomb's rule) — a crash halfway through must not leave a world
  // that burns again on the next close.
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
    // Sequential, never Promise.all, and gibbed — the bomb's rule (db/lib/nukeExplosionPass.js). The
    // conditional claim inside applyDeathToRow stops a resumed turn killing twice.
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
      // Captured before applyDeathToRow nulls it — the thunk still owes Discord this role's deletion.
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
