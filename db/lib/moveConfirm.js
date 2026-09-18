const { describeMoveEffects } = require("./moveEffects");
const { ensureGambitDie } = require("./gambitDie");

// Read at call time, not at import: the bot sets it, the web does not always need it.
const WEB_BASE_URL = process.env.WEB_BASE_URL?.replace(/\/+$/, "") ?? "";

// The word the player sees. ROUTINE is still reachable here for a GM-filed row, and reads as a plain Move.
const MOVE_KIND_WORD = { GAMBIT: "Gambit", ROUTINE: "Move" };

// Locks in a Move — the bot's modal and Chat's Move dialog both file the same way, so this lives in db/lib. A Move filed but never confirmed stays PENDING_TYPE, which the staged push and GM desk skip, costing the player the turn silently.
// `action` must come in with its character and tags loaded.
//
// ONE THING RESOLVES HERE AND ONE DOES NOT.
// A Gambit's d6 IS rolled here, at submit, so a GM can start adjudicating hours before Moves lock instead of waiting on the cutoff. It does not become a re-roll button, because the die is bound to the CHARACTER AND TURN rather than to this row (db/lib/gambitDie.js) — an edit, a withdraw and re-file, or a GM's kind flip all read the same number back. The player is told nothing until the turn closes, same as ever.
// What does NOT resolve here is Action.diceModifier. Hunger and mood stay read at the cutoff by db/lib/gambitCutoff.js, so the die answers what you rolled and the modifier answers how you were when the day closed. A null diceModifier is the signal that the settle pass still owes this row.
async function confirmMove(prisma, action, actorDiscordUserId) {
  // A Move no GM has to touch. Only a GM-filed row reaches here as one — the buttons that spend a
  // day (Mine, Refine, Farm) file their own PASSED Routine and never come through this path.
  const needsNoGm = action.moveKind === "ROUTINE";

  const updated = await prisma.$transaction(async (tx) => {
    // The die, inside the confirming transaction so a Gambit can never end up
    // CONFIRMED without one. ensureGambitDie hands back the turn's existing die
    // when there is one, so a re-file after a withdraw gets the same number.
    // `diceRoll == null` is belt and braces rather than a real branch — only
    // fileMove's rows reach here, and Research/Trinket/heal/Lessons/Confession
    // file their own Gambits with the die already in the row and never confirm
    // through this path. If one ever did, its die is its own.
    const gambit =
      action.moveKind === "GAMBIT" && action.diceRoll == null
        ? await ensureGambitDie(tx, { turnId: action.turnId, character: action.character })
        : null;

    const row = await tx.action.update({
      where: { id: action.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        ...(gambit ? { diceRoll: gambit.die } : {}),
        ...(needsNoGm ? { moveReviewStatus: "PASSED" } : {}),
      },
    });
    return row;
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType: "move_confirmed",
      targetCharacterId: action.characterId,
      details: { actionId: action.id },
    },
  });

  const lines = [
    `» ${action.description}`,
    `Kind: **${MOVE_KIND_WORD[action.moveKind] ?? "Move"}**`,
  ];
  const appliedLine = describeMoveEffects(action.appliedEffects ?? {});
  if (appliedLine) lines.push(`**Applied:** ${appliedLine}`);
  // Says WHERE on purpose for a Gambit: editing and cancelling live on the web only — the
  // Discord modal can file and nothing else — so a bare "you can edit it" would send a
  // Discord-first player hunting for a button that isn't there.
  lines.push(
    action.moveKind === "GAMBIT"
      ? `» *Your Gambit was declared. You can edit it until the turn locks${WEB_BASE_URL ? `, at ${WEB_BASE_URL}/character` : ", from your sheet on the web"}.*`
      : "» *Done.*",
  );

  return {
    updated,
    lines,
    roll: {
      gambit: action.moveKind === "GAMBIT",
      resourceValue: rollResult ? rollResult.value : null,
      // `-#` is Discord subtext; a plain-text surface strips the prefix.
      bonusNote: bonusNote ? bonusNote.replace(/^-#\s*/, "") : null,
      applied: appliedLine || null,
    },
  };
}

module.exports = { confirmMove };
