// The bomb goes off. TURN-ENGINE.md's newest pass, the only one that can end
// most of a game in a single close.
//
// ORDERING IS LOAD-BEARING. Must run AFTER tagExpiry and the staged push, so
// a Disarm filed this turn (or a GM defusing from /gm/dev) beats the clock —
// same rule dyingDeath follows. BEFORE the expiry sweep, so it sits with its
// siblings; it reads GameConfig rather than a tag, so the sweep can't eat its
// trigger.
//
// WHO DIES: every ALIVE character whose zone is not a CAVE_LEVEL — being
// under the rock is the whole escape. A never-placed character is left alone.
//
// DB writes only. Discord work comes back as `deaths` and `broadcast` for the
// side-effect thunk (catatonicDeathPass.js's contract exactly) — a pass that
// posts to Discord inside the turn transaction can wedge a turn on a 429.
// Takes `prisma` as a parameter — see db/lib/dm.js.
const { applyDeathToRow } = require("./characterDeath");
const { alivePassCharacters } = require("./aliveCharacters");

// The @everyone is the point: this is the one event that should wake
// somebody asleep.
const DETONATION_LINE =
  "You hear a deafening roar. There's a fireball in the sky. @everyone";

// What each victim is told, and what #leave reads.
const BLAST_DEATH_REASON = "the blast caught them above ground and left nothing behind.";

async function runNukeExplosionPass(prisma, turn) {
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    include: { game: { select: { id: true, nukeDetonatedTurn: true } } },
  });

  // Not armed, or armed for a turn not yet come. An object, not null: null
  // would mean "did not run, retry forever" and wedge every turn.
  const armedTurn = state?.nukeArmedTurn ?? null;
  if (armedTurn == null || armedTurn > turn.number) {
    return { turnNumber: turn.number, detonated: false, killed: 0, deaths: [], broadcast: null };
  }

  // An armed bomb says so in the log BEFORE it goes off, not only after.
  console.log(
    `Nuclear device: armed for turn ${armedTurn}, closing turn ${turn.number}, game ${state?.game?.id ?? "?"}.`,
  );

  // Already gone off IN THIS GAME. Read off the Game row, not GameState:
  // turn numbers restart at 1 every game, so a fresh game could inherit the
  // last one's stamp as its own.
  if (state?.game?.nukeDetonatedTurn != null) {
    return { turnNumber: turn.number, detonated: false, killed: 0, deaths: [], broadcast: null };
  }

  // Claim it first: writing the detonation stamp before the killing starts
  // means a crash halfway through can't leave a world that explodes again.
  await prisma.gameState.update({
    where: { id: 1 },
    data: { nukeDetonatedTurn: turn.number, nukeArmedTurn: null },
  });
  if (state?.game?.id) {
    await prisma.game.update({
      where: { id: state.game.id },
      data: { nukeDetonatedTurn: turn.number },
    });
  }

  const doomed = await alivePassCharacters(prisma, {
    where: { zone: { kind: { not: "CAVE_LEVEL" } } },
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
    // Sequential, never Promise.all: applyDeathToRow's conditional claim is
    // what keeps a resumed turn from killing twice. Gibbed, not merely
    // killed: nobody above ground leaves a body to loot or bury.
    const { claimed } = await applyDeathToRow(prisma, character, {
      turn,
      gib: true,
      content: `${character.name} died in the blast.`,
      cause: { kind: "system", system: "nuke" },
    });
    if (!claimed) continue;
    deaths.push({
      characterId: character.id,
      name: character.name,
      discordUserId: character.discordUserId,
      // Captured before applyDeathToRow nulls it — the thunk owes Discord
      // this role's deletion.
      discordRoleId: character.discordRoleId,
      zoneId: character.zoneId,
      reason: BLAST_DEATH_REASON,
    });
  }

  return {
    turnNumber: turn.number,
    gameId: state?.game?.id ?? null,
    detonated: true,
    killed: deaths.length,
    deaths,
    broadcast: { content: DETONATION_LINE, mentionEveryone: true },
  };
}

module.exports = { runNukeExplosionPass, DETONATION_LINE };
