// The bomb goes off. TURN-ENGINE.md's newest pass, and the only one that can
// end most of a game in a single close.
//
// ORDERING IS LOAD-BEARING. It must run:
//   - AFTER tagExpiry and the staged push, so a Disarm filed this turn — or a
//     GM defusing it from /gm/dev — beats the clock. Same rule dyingDeath
//     already follows, and for the same reason: the last word belongs to the
//     people who acted, not to the timer.
//   - BEFORE the expiry sweep, purely so it sits with its siblings. It reads
//     GameConfig rather than a tag, so the sweep cannot actually eat its
//     trigger the way it would have eaten an armed tag — which is one of the
//     reasons the countdown lives where it does.
//
// WHO DIES: every ALIVE character whose zone is not a CAVE_LEVEL. The Caves
// and the Depths are the only two, and being under the rock is the whole
// escape. A character with no zone at all (never placed) is left alone — the
// blast is a fact about the map, and they are not on it.
//
// DB writes only. Discord work comes back as `deaths` and `broadcast` for the
// side-effect thunk, the catatonicDeathPass.js contract exactly — a pass that
// posts to Discord inside the turn transaction is a pass that can wedge a
// turn on a 429.
//
// Takes `prisma` as a parameter — see db/lib/dm.js.
const { applyDeathToRow } = require("./characterDeath");
const { alivePassCharacters } = require("./aliveCharacters");

// What every #summary reads, verbatim from Bascinet. The @everyone is the
// point: this is the one event in the game that should wake somebody who is
// asleep. Unsigned — these are their words.
const DETONATION_LINE =
  "You hear a deafening roar. There's a fireball in the sky. @everyone";

// What each victim is told, and what #leave reads. Until this existed the
// `deaths` entries below carried no `reason` at all, and db/index.js's shared
// death-DM loop interpolated it anyway — so everybody killed by the bomb was
// DM'd the literal string "You have died. undefined".
const BLAST_DEATH_REASON = "the blast caught them above ground and left nothing behind.";

async function runNukeExplosionPass(prisma, turn) {
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    include: { game: { select: { id: true, nukeDetonatedTurn: true } } },
  });

  // Not armed, or armed for a turn that has not come yet. Returning an object
  // rather than null matters: null means "did not run, retry forever" and
  // would wedge every turn from here on.
  const armedTurn = state?.nukeArmedTurn ?? null;
  if (armedTurn == null || armedTurn > turn.number) {
    return { turnNumber: turn.number, detonated: false, killed: 0, deaths: [], broadcast: null };
  }

  // An armed bomb says so in the log BEFORE it goes off, not only after. On
  // 2026-09-09 a game one turn old detonated with nothing in the audit trail
  // saying it had ever been armed, and there was no way to tell afterwards
  // whether the arming belonged to that game at all.
  console.log(
    `Nuclear device: armed for turn ${armedTurn}, closing turn ${turn.number}, game ${state?.game?.id ?? "?"}.`,
  );

  // Already gone off IN THIS GAME. Read off the Game row, not GameState:
  // turn numbers restart at 1 every game, so the old GameState stamp was
  // meaningless across a restart — a fresh game read the last one's stamp as
  // its own and inherited the fireball.
  if (state?.game?.nukeDetonatedTurn != null) {
    return { turnNumber: turn.number, detonated: false, killed: 0, deaths: [], broadcast: null };
  }

  // Claim it first. Disarming clears nukeArmedTurn, so writing the detonation
  // stamp before the killing starts means a crash halfway through cannot
  // leave a world that explodes again on the next close. GameState keeps its
  // copy as a forensic record; the Game row is the one anything reads.
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
    // Sequential, never Promise.all: each applyDeathToRow mints a corpse,
    // vacates a faction office and writes an archive row, and the conditional
    // claim inside it is what makes a resumed turn unable to kill twice.
    // Gibbed, not merely killed: nobody above ground leaves a body, so there
    // are no corpses to loot or bury after the bomb and every tag they carried
    // goes up with them.
    const { claimed } = await applyDeathToRow(prisma, character, {
      turn,
      gib: true,
      content: `${character.name} died in the blast.`,
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
