const { formatLaborBonusNote, lazyYield, lazyExpression } = require("./laborAccess");
const { rollResourceRange } = require("./resourceDelta");
const { applyMoveEffects, describeMoveEffects } = require("./moveEffects");

// Read at call time, not at import: the bot sets it, the web does not always need it.
const WEB_BASE_URL = process.env.WEB_BASE_URL?.replace(/\/+$/, "") ?? "";

// The word the player sees. ROUTINE is still reachable here for a GM-filed row, and reads as a plain Move.
const MOVE_KIND_WORD = { GAMBIT: "Gambit", LABOR: "Labor", ROUTINE: "Move" };

// Locks in a Move — the bot's modal and Chat's Move dialog both file the same way, so this lives in db/lib. A Move filed but never confirmed stays PENDING_TYPE, which the staged push and GM desk skip, costing the player the turn silently.
// `action` must come in with its character and tags loaded.
//
// TWO THINGS RESOLVE HERE AND ONE DOES NOT.
// Labor pays on the spot: the ⬢ and any labor drop land now, and `appliedEffects` is stamped so the turn-end push skips the row (stagedPush.js filters on appliedEffects being null). A Labor Move is a receipt — the work is done and the day is spent.
// A Gambit's d6 is NOT rolled here any more. It is rolled once, at the Move cutoff, by db/lib/gambitCutoff.js. That is what lets a player rewrite or withdraw a Gambit until lock-in without it becoming a re-roll button: there is nothing to re-roll until the window shuts.
async function confirmMove(prisma, action, actorDiscordUserId, { laborRate = null } = {}) {
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

  // A Move no GM has to touch. Labor belongs here beside Routine: its payout is a roll, not a judgement anybody makes (db/lib/autoLaborPass.js files its own as PASSED too).
  const needsNoGm = action.moveKind === "ROUTINE" || action.moveKind === "LABOR";
  // Labor is settled the moment it's filed, so it is paid here rather than at the close.
  const payNow = action.moveKind === "LABOR";

  // What paying it actually moved — the ⬢, a labor drop, the Tired that comes of a long
  // day, a refining shift's Squeeze. Reported HERE for a Labor, because it no longer
  // reaches the turn-end DM that used to be the only place it was said.
  let applied = null;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.action.update({
      where: { id: action.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        ...(rollResult
          ? { resourceRollValue: rollResult.value, resourceDelta, resourceRollExpression: laborExpression }
          : {}),
        ...(needsNoGm ? { moveReviewStatus: "PASSED" } : {}),
      },
    });
    if (!payNow) return row;

    // The same claim-then-apply the staged push uses (stagedPush.js §2), so the two can never both pay: whichever stamps `appliedEffects` first owns the payout, and this one is inside the confirming transaction.
    applied = await applyMoveEffects(tx, row);
    return await tx.action.update({ where: { id: row.id }, data: { appliedEffects: applied } });
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType: "move_confirmed",
      targetCharacterId: action.characterId,
      details: {
        actionId: action.id,
        resourceRollValue: rollResult?.value ?? null,
        paidNow: payNow,
      },
    },
  });

  const bonusNote = rollResult && laborRate ? formatLaborBonusNote(laborRate) : null;

  const lines = [
    `» ${action.description}`,
    `Kind: **${MOVE_KIND_WORD[action.moveKind] ?? "Move"}**`,
  ];
  // A Labor says what it produced, in one line. It used to print the roll and the range it
  // came out of ("Resource roll (0-9): +5 ⬢"); the range was mechanics a player could do
  // nothing with, and the payout is the only part they act on.
  if (rollResult) {
    lines.push(`You labored, producing ${rollResult.value} ⬢`);
    // The range has the tools baked in, so a hunter with a Longbow is still told their kit did something.
    if (bonusNote) lines.push(bonusNote);
  }
  // Everything else the day turned up. `resources` is dropped: the roll line above already said it, in the range's own words.
  const appliedLine = describeMoveEffects(
    Object.fromEntries(Object.entries(applied ?? {}).filter(([key]) => key !== "resources")),
  );
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
