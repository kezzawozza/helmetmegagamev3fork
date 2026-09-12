const { gambitModifiers, gambitModifierTotal } = require("./gambitModifier");
const { rollWithAdvantage } = require("./advantage");
const { formatLaborBonusNote, lazyYield, lazyExpression } = require("./laborAccess");
const { rollResourceRange, formatRangeExpression } = require("./resourceDelta");

// Locks in a Move. Both faces file the same way — the bot's modal
// (bot/src/events/interactionCreate.js#handleMoveSubmit) and Chat's
// Move dialog (web/app/(app)/chat/actions.js#submitMove) — so this lives in
// db/lib and neither one owns it. A Move that is filed but never confirmed
// stays PENDING_TYPE, which the staged push (db/lib/stagedPush.js) skips and
// the GM desk never shows, so it costs the player the turn silently.
//
// Resources land at the turn-end staged push, not here. The Gambit die is
// rolled and stored now so the GM desk has it immediately, but withheld from
// the player until the turn-end reveal DM (stagedPush.js's
// gambitRollNotices) — seeing it early shouldn't color how the rest of the
// turn gets played.
//
// `action` must come in with its character, tags, AND hungerStreak loaded
// (db/lib/gambitModifier.js needs both). `laborRate` is the resolver's whole
// return value from the submit path (db/lib/laborAccess.js), carried because
// the Action stores only the finished range and not which tools made it that
// size.
//
// Returns { updated, lines, roll }; writes its own AuditLog row but sends
// nothing. `lines` is the Discord-flavoured block the bot replies with;
// `roll` is the same facts unformatted, for a surface that renders plain
// text instead.
async function confirmMove(prisma, action, actorDiscordUserId, { laborRate = null } = {}) {
  // Lucky rolls this twice and keeps the better die (db/lib/advantage.js).
  // `diceRoll` stays the die that COUNTS, so everything downstream — the
  // stored column, the threshold checks, the reveal DM — is unchanged; the
  // discarded die rides along in `advantage` for the roll line alone.
  const advantage = action.moveKind === "GAMBIT" ? rollWithAdvantage(action.character.tags) : null;
  const diceRoll = advantage ? advantage.die : null;
  // Only a Gambit rolls, so only a Gambit can carry a modifier. diceRoll stays
  // the RAW roll and the SUM of every contributor (Hunger scaled to the
  // streak, and the bottom two mood bands) is stored beside it — see the
  // Action.diceModifier comment in schema.prisma. The per-contributor
  // breakdown is display-only, below.
  const opts = { hungerStreak: action.character.hungerStreak, mood: action.character.mood };
  const modifiers = diceRoll != null ? gambitModifiers(action.character.tags, opts) : [];
  const diceModifier = diceRoll != null ? gambitModifierTotal(action.character.tags, opts) : null;
  // Null for a row written before ranges existed (a leftover "1d4*3"), which
  // then confirms on its flat delta alone rather than throwing.
  const rollResult = action.resourceRollExpression ? rollResourceRange(action.resourceRollExpression) : null;
  // Lazy takes its quarter after the roll, not off the range — same rule as
  // the auto-labor pass (db/lib/autoLaborPass.js).
  // The expression stamped at submit time is the pre-Lazy range (see
  // db/lib/moves.js). Cut it the same way the rolled value is, so the sheet
  // and the GM desk print the range the payout is actually inside rather than
  // the wider pre-cut one.
  let laborExpression = action.resourceRollExpression;
  if (rollResult) {
    const heldSlugs = new Set((action.character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
    rollResult.value = lazyYield(rollResult.value, heldSlugs);
    laborExpression = lazyExpression(action.resourceRollExpression, heldSlugs);
  }

  const resourceDelta = rollResult
    ? (action.resourceDelta ?? 0) + rollResult.value
    : (action.resourceDelta ?? null);

  // A Move no GM has to touch. Labor belongs here beside Routine: its payout
  // is a die the turn close rolls, not a judgement anybody makes, which is
  // why db/lib/autoLaborPass.js has always filed its own as PASSED. A
  // player-submitted Labor was the one that came out OPEN, so it sat in the
  // desk's queue asking for an adjudication that has no verb, and the sheet
  // read it as a turn still unspent.
  const needsNoGm = action.moveKind === "ROUTINE" || action.moveKind === "LABOR";

  const updated = await prisma.action.update({
    where: { id: action.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      ...(diceRoll != null ? { diceRoll, diceModifier } : {}),
      ...(rollResult
        ? { resourceRollValue: rollResult.value, resourceDelta, resourceRollExpression: laborExpression }
        : {}),
      // PASSED means "no GM needs to touch this", not "paid" — appliedEffects
      // stays null until the staged push claims it at rollover.
      ...(needsNoGm ? { moveReviewStatus: "PASSED" } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType: "move_confirmed",
      targetCharacterId: action.characterId,
      details: {
        actionId: action.id,
        diceRoll,
        diceModifier,
        // The only place the breakdown survives — the column stores the sum.
        diceModifiers: modifiers,
        resourceRollValue: rollResult?.value ?? null,
      },
    },
  });

  const bonusNote = rollResult && laborRate ? formatLaborBonusNote(laborRate) : null;

  const lines = [
    `» ${action.description}`,
    `Kind: **${action.moveKind === "GAMBIT" ? "Gambit" : "Routine"}**`,
  ];
  if (diceRoll != null) {
    // No number here on purpose — see the header comment. The reveal is the DM
    // at the turn-end staged push (db/lib/stagedPush.js's gambitRollNotices),
    // which lands beside the adjudication DMs that say what the roll did.
    lines.push("🎲 *The die is cast. You'll see how it fell when the turn ends.*");
  }
  if (rollResult) {
    lines.push(
      `**Resource roll (${formatRangeExpression(laborExpression)}):** ${rollResult.value > 0 ? "+" : ""}${rollResult.value} ⬢`,
    );
    // The range above already has the tools baked in, so say so — otherwise a
    // hunter with a Longbow sees 3-12 and has no way to know it isn't the
    // plain 0-9.
    if (bonusNote) lines.push(bonusNote);
  }
  lines.push("» *Locked in. Results land when the turn ends.*");

  return {
    updated,
    lines,
    roll: {
      gambit: diceRoll != null,
      // The rolled ⬢, and the range it came out of, already cut for Lazy.
      resourceValue: rollResult ? rollResult.value : null,
      expression: rollResult ? formatRangeExpression(laborExpression) : null,
      // `-#` is Discord subtext; a plain-text surface strips the prefix.
      bonusNote: bonusNote ? bonusNote.replace(/^-#\s*/, "") : null,
    },
  };
}

module.exports = { confirmMove };
