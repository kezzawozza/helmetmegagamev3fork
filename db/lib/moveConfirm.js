const { gambitModifiers, gambitModifierTotal } = require("./gambitModifier");
const { rollWithAdvantage } = require("./advantage");
const { consumeInspiredIfUsed } = require("./tagWrites");
const { formatLaborBonusNote, lazyYield, lazyExpression } = require("./laborAccess");
const { rollResourceRange, formatRangeExpression } = require("./resourceDelta");

// Locks in a Move — the bot's modal and Chat's Move dialog both file the same way, so this lives in db/lib. A Move filed but never confirmed stays PENDING_TYPE, which the staged push and GM desk skip, costing the player the turn silently.
// `action` must come in with its character, tags, AND hungerStreak loaded (db/lib/gambitModifier.js needs both). Resources land at the turn-end staged push; the Gambit die is rolled now for the GM desk but withheld until the reveal DM (stagedPush.js's gambitRollNotices).
async function confirmMove(prisma, action, actorDiscordUserId, { laborRate = null } = {}) {
  // Lucky rolls this twice and keeps the better die (db/lib/advantage.js); the discarded die rides along in `advantage` for the roll line alone. Inspired is spent the instant it wins a Gambit — Lucky never is.
  const advantage =
    action.moveKind === "GAMBIT" ? rollWithAdvantage(action.character.tags, 6, { gambitOnly: true }) : null;
  const diceRoll = advantage ? advantage.die : null;
  if (advantage) await consumeInspiredIfUsed(prisma, action.character.id, advantage.source);
  // Only a Gambit rolls; diceRoll stays the RAW roll, with the SUM of every contributor stored beside it as diceModifier (see schema.prisma).
  const opts = { hungerStreak: action.character.hungerStreak, mood: action.character.mood };
  const modifiers = diceRoll != null ? gambitModifiers(action.character.tags, opts) : [];
  const diceModifier = diceRoll != null ? gambitModifierTotal(action.character.tags, opts) : null;
  const rollResult = action.resourceRollExpression ? rollResourceRange(action.resourceRollExpression) : null;
  // Lazy takes its quarter after the roll, not off the range — same rule as the auto-labor pass. Cut laborExpression the same way so the sheet/GM desk print the range the payout is actually inside.
  let laborExpression = action.resourceRollExpression;
  if (rollResult) {
    const heldSlugs = new Set((action.character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
    rollResult.value = lazyYield(rollResult.value, heldSlugs);
    laborExpression = lazyExpression(action.resourceRollExpression, heldSlugs);
  }

  const resourceDelta = rollResult
    ? (action.resourceDelta ?? 0) + rollResult.value
    : (action.resourceDelta ?? null);

  // A Move no GM has to touch. Labor belongs here beside Routine: its payout is a die the turn close rolls, not a judgement anybody makes (db/lib/autoLaborPass.js files its own as PASSED too).
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
      // PASSED means "no GM needs to touch this", not "paid" — appliedEffects stays null until the staged push claims it.
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
    lines.push("🎲 *The die is cast. You'll see how it fell when the turn ends.*");
  }
  if (rollResult) {
    lines.push(
      `**Resource roll (${formatRangeExpression(laborExpression)}):** ${rollResult.value > 0 ? "+" : ""}${rollResult.value} ⬢`,
    );
    // The range above already has the tools baked in, so say so — otherwise a hunter with a Longbow can't tell 3-12 from the plain 0-9.
    if (bonusNote) lines.push(bonusNote);
  }
  lines.push("» *Locked in. Results land when the turn ends.*");

  return {
    updated,
    lines,
    roll: {
      gambit: diceRoll != null,
      resourceValue: rollResult ? rollResult.value : null,
      expression: rollResult ? formatRangeExpression(laborExpression) : null,
      // `-#` is Discord subtext; a plain-text surface strips the prefix.
      bonusNote: bonusNote ? bonusNote.replace(/^-#\s*/, "") : null,
    },
  };
}

module.exports = { confirmMove };
