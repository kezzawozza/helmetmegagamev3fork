// Throws every pending Gambit's d6, once, at the moment Moves lock.
//
// This used to happen at submit (db/lib/moveConfirm.js), and that is precisely why a filed Move
// could never be edited: changing kinds re-confirmed the row, re-confirming rolled, so an uncapped
// Edit was a re-roll button you could flip Gambit → Routine → Gambit on all afternoon. Moving the
// roll to the cutoff removes the prize instead of forbidding the act — there is nothing to fish for
// until the window shuts, and once it has shut nobody can touch their Move anyway.
//
// It also makes the modifiers honest: Hunger and mood are read at the cutoff, so the die answers
// how the character was when the day closed, not how they were when they happened to type.
//
// There is no lock EVENT to hang this on, so it is a per-minute poll sharing turnClock.js's
// `cutoffReached` with the Oracle's own cutoff run. Two consequences worth knowing: the bot process
// drives it (a web-only deploy never ticks), and a frozen clock or a turn shorter than
// MOVE_LOCK_HOURS never locks at all. `rollPendingGambits` is therefore ALSO called at the head of
// the staged push, as the backstop — a turn that never locked still has to resolve.
const { cutoffReached } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { rollWithAdvantage } = require("./advantage");
const { consumeInspiredIfUsed } = require("./tagWrites");
const { gambitModifierTotal } = require("./gambitModifier");

// Every Gambit on this turn still waiting for its die. A CONFIRMED row only: an abandoned modal
// draft (PENDING_TYPE) is not a Move. Research, the forge's Trinket and an above-skill heal file
// their own Gambits with the die already in the row, so a non-null `diceRoll` excludes them here
// for free — they pay their costs at the click and have never been part of the cutoff.
async function pendingGambits(db, turnId) {
  return db.action.findMany({
    where: { turnId, moveKind: "GAMBIT", status: "CONFIRMED", diceRoll: null },
    select: {
      id: true,
      characterId: true,
      character: {
        select: {
          id: true,
          mood: true,
          tags: { select: { tag: { select: { slug: true } } } },
        },
      },
    },
  });
}

// Rolls each one under a claim, so two ticks racing can never both roll the same Move. That matters
// beyond the die: Inspired is SPENT when it wins a roll, and a double roll would burn it twice.
// Returns how many dice it actually threw.
async function rollPendingGambits(db, turnId) {
  const rows = await pendingGambits(db, turnId);
  let rolled = 0;

  for (const action of rows) {
    try {
      const character = action.character;
      if (!character) continue;

      // Lucky throws this twice and keeps the better die (db/lib/advantage.js). Inspired is spent
      // the instant it wins one — but only once the claim below has actually landed.
      const advantage = rollWithAdvantage(character.tags, 6, { gambitOnly: true });
      const diceModifier = gambitModifierTotal(character.tags, { mood: character.mood });

      // The claim IS the `diceRoll: null` in the WHERE. A second tick finds count 0 and drops
      // its roll on the floor, un-spent. Paired with the Inspired spend in ONE transaction:
      // Inspired is consumed only when it WON the roll, so a crash between the two would
      // leave a boosted die on the row with the tag still in the player's pocket, ready to
      // boost tomorrow's as well.
      const claimed = await db.$transaction(async (tx) => {
        const claim = await tx.action.updateMany({
          where: { id: action.id, diceRoll: null },
          data: { diceRoll: advantage.die, diceModifier },
        });
        if (claim.count === 0) return false;
        await consumeInspiredIfUsed(tx, character.id, advantage.source);
        return true;
      });
      if (!claimed) continue;

      rolled += 1;
    } catch (err) {
      // One bad row must not cost the rest of the table their dice.
      console.error(`Gambit roll for action ${action.id} failed:`, err);
    }
  }

  return rolled;
}

// The per-minute entry point. Idle is `{ ran: false }` and costs one indexed query.
async function runGambitCutoff(db, { now = new Date() } = {}) {
  const turn = await db.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, startedAt: true },
  });
  if (!turn) return { ran: false };

  const { at } = cutoffReached(turn, { now, clockFrozen: await clockFrozen(db) });
  if (!at) return { ran: false };

  const rolled = await rollPendingGambits(db, turn.id);
  // Nothing left to roll is the steady state for all but the first tick after the lock, so it is not
  // worth a log line — `ran` says a tick did the work, `rolled` says whether there was any.
  return { ran: true, rolled, turnNumber: turn.number };
}

module.exports = { runGambitCutoff, rollPendingGambits };
