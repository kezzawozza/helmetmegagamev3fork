// The one place a player's Gambit d6 is thrown (docs/systemdocs/ADJUDICATION.md).
//
// THE DIE BELONGS TO THE CHARACTER AND THE TURN, NOT TO THE MOVE. It is thrown
// once, at the first Gambit confirm of the turn, so a GM can start adjudicating
// hours before Moves lock instead of waiting on the cutoff. Every later path —
// an edit, a withdraw and re-file, a GM flipping the kind on the desk — reads
// this row back rather than throwing again.
//
// That binding is the whole design, not an implementation detail. Rolling at
// submit is exactly what the cutoff was built to avoid: it made Edit a re-roll
// button you could flip Gambit → Routine → Gambit on all afternoon. Delaying
// the roll removed the prize. So does this, without also costing the player
// their edit window — there is nothing to fish for when every throw for the
// turn returns the same number.
//
// Withdrawing does NOT hand Inspired back. The row is the spend, it outlives the
// Action (withdraw deletes that outright — moveEconomy.js#deleteActionRestoringTurn),
// and re-filing returns the same boosted die. Refunding would mean deleting this
// row, which is the fishing loop again. A player keeps the advantage they paid
// for; they just cannot shop with it.
//
// What is NOT decided here: Action.diceModifier. Hunger and mood are still read
// at the cutoff by db/lib/gambitCutoff.js, so the die answers what you rolled
// and the modifier answers how you were when the day closed. There is no
// randomness in a modifier, so there is nothing to fish for on that side either.
const { rollWithAdvantage } = require("./advantage");
const { consumeInspiredIfUsed } = require("./tagWrites");

// Throws this character's die for this turn, or hands back the one already
// thrown. Takes a transaction client: the caller's own write and this claim must
// commit together, or a crash between them leaves a die nobody's Move carries.
//
// `character` needs { id, tags } — tags is all rollWithAdvantage reads.
// -> { die, rolls, source, fresh }. `fresh` is true only for the caller that
// actually threw it, and is what says whether Inspired was just spent.
async function ensureGambitDie(tx, { turnId, character }) {
  const advantage = rollWithAdvantage(character.tags, 6, { gambitOnly: true });

  // createMany({ skipDuplicates }) rather than create + catch P2002, and the
  // difference matters: this compiles to ON CONFLICT DO NOTHING, whereas a
  // raised P2002 inside a Prisma interactive transaction poisons the whole
  // transaction on Postgres — the confirm would roll the Move back along with
  // the die. Under READ COMMITTED a concurrent UNCOMMITTED insert blocks here on
  // the row lock and then returns 0, so the read below always sees the winner.
  const claim = await tx.gambitDie.createMany({
    data: [
      {
        characterId: character.id,
        turnId,
        die: advantage.die,
        rolls: advantage.rolls,
        advantageSource: advantage.source,
      },
    ],
    skipDuplicates: true,
  });

  if (claim.count === 1) {
    // Inspired is spent by the throw, and only by the throw. Paired with the
    // claim in one transaction so a crash between them can never leave a boosted
    // die on the row with the tag still in the player's pocket.
    await consumeInspiredIfUsed(tx, character.id, advantage.source);
    return { die: advantage.die, rolls: advantage.rolls, source: advantage.source, fresh: true };
  }

  // Somebody got here first. Drop our roll on the floor un-spent — touching
  // Inspired here would burn it twice for one die.
  const existing = await tx.gambitDie.findUnique({
    where: { characterId_turnId: { characterId: character.id, turnId } },
    select: { die: true, rolls: true, advantageSource: true },
  });
  return { die: existing.die, rolls: existing.rolls, source: existing.advantageSource, fresh: false };
}

module.exports = { ensureGambitDie };
