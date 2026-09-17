// Settles every player Gambit at the moment Moves lock: the Hunger/mood modifier lands here, and a die
// lands too for any row that somehow reached the lock without one.
//
// THE DIE ITSELF IS NO LONGER THROWN HERE on the ordinary path. It is thrown at submit
// (db/lib/moveConfirm.js → db/lib/gambitDie.js) so a GM can start adjudicating hours earlier instead
// of waiting on the cutoff. That used to be impossible: rolling at submit made an uncapped Edit a
// re-roll button you could flip Gambit → Routine → Gambit on all afternoon, which is why the roll
// moved here in the first place. What removes the prize now is not the delay but the BINDING — one
// die per character per turn, in its own row, read back by every edit, withdraw, re-file and GM kind
// flip. There is nothing to fish for when every throw returns the same number, so the player keeps
// their edit window and the desk still gets the die at breakfast.
//
// What stays here is what should: the modifier. Hunger and mood are read at the cutoff, so the die
// answers what you rolled and the modifier answers how the character was when the day closed. A null
// `diceModifier` is the signal that this pass still owes a row, and it is also the claim.
//
// The roll branch below is NOT dead code. It covers rows confirmed before this changed, and any
// CONFIRMED Gambit that never went through confirmMove at all.
//
// There is no lock EVENT to hang this on, so it is a per-minute poll sharing turnClock.js's
// `cutoffReached` with the Oracle's own cutoff run. Two consequences worth knowing: the bot process
// drives it (a web-only deploy never ticks), and a frozen clock or a turn shorter than
// MOVE_LOCK_HOURS never locks at all. `settleGambitDice` is therefore ALSO called at the head of
// the staged push, as the backstop — a turn that never locked still has to resolve.
const { cutoffReached } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { gambitModifierTotal } = require("./gambitModifier");
const { ensureGambitDie } = require("./gambitDie");

// Every player Gambit on this turn still waiting to be settled. A CONFIRMED row only: an abandoned
// modal draft (PENDING_TYPE) is not a Move.
//
// `playerFiled` IS THE DISCRIMINATOR, and getting it wrong is the sharpest edge in this file.
// Research, the forge's Trinket, an above-skill heal, a lesson and a confession all file their own
// Gambits with the die already in the row. `diceRoll: null` used to exclude them for free; now that
// a player's own Gambit carries a die from submit, it no longer tells them apart. `diceModifier:
// null` ALONE would be wrong in the other direction — trinketPass.js deliberately leaves the
// modifier null because folding Hunger in "could knock it back down", so a pass keyed on that would
// stamp a Hunger penalty on a Trinket roll. `playerFiled` is the honest answer: it defaults to false
// and db/lib/moves.js#fileMove is the only thing that sets it true, so all five self-rollers are out.
async function pendingGambits(db, turnId) {
  return db.action.findMany({
    where: { turnId, moveKind: "GAMBIT", status: "CONFIRMED", playerFiled: true, diceModifier: null },
    select: {
      id: true,
      characterId: true,
      diceRoll: true,
      character: {
        select: {
          id: true,
          hungerStreak: true,
          mood: true,
          tags: { select: { tag: { select: { slug: true } } } },
        },
      },
    },
  });
}

// Settles each one under a claim, so two ticks racing can never both stamp the same Move. On the
// backstop path that matters beyond tidiness — ensureGambitDie SPENDS Inspired when it wins a roll,
// and a double throw would burn it twice — though its own unique index would catch that anyway.
// Returns how many rows it actually settled.
async function settleGambitDice(db, turnId) {
  const rows = await pendingGambits(db, turnId);
  let settled = 0;

  for (const action of rows) {
    try {
      const character = action.character;
      if (!character) continue;

      const diceModifier = gambitModifierTotal(character.tags, {
        hungerStreak: character.hungerStreak,
        mood: character.mood,
      });

      // The claim IS the `diceModifier: null` in the WHERE. A second tick finds count 0 and drops
      // everything on the floor. On the ordinary path the die was thrown at submit and this only
      // stamps the modifier; the branch below is the backstop for a row that arrived without one.
      const claimed = await db.$transaction(async (tx) => {
        // ensureGambitDie is called ONLY when the row has no die — it writes a GambitDie row and
        // may spend Inspired, and neither should happen for a Move that already has its number.
        const gambit = action.diceRoll == null ? await ensureGambitDie(tx, { turnId, character }) : null;

        const claim = await tx.action.updateMany({
          where: { id: action.id, diceModifier: null },
          data: { diceModifier, ...(gambit ? { diceRoll: gambit.die } : {}) },
        });
        return claim.count > 0;
      });
      if (!claimed) continue;

      settled += 1;
    } catch (err) {
      // One bad row must not cost the rest of the table their dice.
      console.error(`Gambit settle for action ${action.id} failed:`, err);
    }
  }

  return settled;
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

  const settled = await settleGambitDice(db, turn.id);
  // Nothing left to settle is the steady state for all but the first tick after the lock, so it is
  // not worth a log line — `ran` says a tick did the work, `settled` says whether there was any.
  return { ran: true, settled, turnNumber: turn.number };
}

module.exports = { runGambitCutoff, settleGambitDice };
