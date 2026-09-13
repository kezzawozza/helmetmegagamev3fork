// What a filed tax actually DOES: moves ⬢ or Obols from the target to the
// taxer, unless it was refused — the close-of-turn half of Taxman
// (docs/tags.yaml's `taxman` description; db/lib/tax.js files the row,
// this resolves it). Run from db/index.js#resolveNeeds().
//
// Slot: right after "stagedPush", before "tagExpiry" — after autoLabor (a
// tax collects on what the day earned) and after a GM's own staged
// adjudication (which outranks a player verb, everywhere else in this list
// too), and BEFORE "horseUpkeep"/"hunger": the animal eats before the rider
// does (horseUpkeepPass.js's own rule), and a tax is the same kind of levy —
// it can push someone into Hunger, which is the Headman's own "take
// everything they have" made mechanical.
//
// ONE TRANSACTION PER ROW, never one around the whole batch (stagedPush.js's
// rule): a bad row must not roll back the others.
//
// CATATONIC IS NOT SPECIAL-CASED, ANYWHERE IN THIS FILE, AND MUST STAY THAT
// WAY. A Catatonic target simply never clicks Refuse — they're not there to.
// That is the entire mechanism behind the tag's own "unless the player is
// Catatonic" line. Every transfer surface in the game already filters
// "ALIVE" alone, with no protection for a Catatonic balance, so adding an
// `if (catatonic)` branch here would not fix a gap — it would invent a
// permission this tag was never meant to carry.
const { resolveParty } = require("./parties");
const { applyTransfer, InsufficientResourcesError } = require("./resourceTransfer");
const { addToStack, dropCharacterTag } = require("./tagWrites");
const { OBOL_SLUG } = require("./depotState");

async function runTaxPass(prisma, turn) {
  const rows = await prisma.pendingTax.findMany({
    where: { turnId: turn.id, appliedAt: null, declinedAt: null },
    orderBy: { createdAt: "asc" },
  });
  // Only ever looked up once per pass, and only matters for an OBOL row —
  // cheap to fetch unconditionally rather than branch on whether any row
  // needs it.
  const obolTag = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } });

  let applied = 0;
  let skipped = 0;
  let moved = 0;
  const failures = [];

  for (const row of rows) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // The claim IS the double-apply guard, and it re-checks declinedAt:
        // a refusal landing between the findMany above and here still wins.
        const claim = await tx.pendingTax.updateMany({
          where: { id: row.id, appliedAt: null, declinedAt: null },
          data: { appliedAt: new Date() },
        });
        if (claim.count === 0) return null;

        const [from, to] = await Promise.all([
          resolveParty(tx, `character:${row.targetId}`),
          resolveParty(tx, `character:${row.taxerId}`),
        ]);
        if (!from || !to) {
          await tx.pendingTax.update({
            where: { id: row.id },
            data: { appliedAmount: 0, skippedReason: "gone" },
          });
          return { moved: 0, skipped: true };
        }

        // Obols are a physical Tag stack (DEPOT.md), not a balance column, so
        // they move through the tag primitives instead of resourceTransfer's
        // applyTransfer — same "clamp to what they actually have" rule, just
        // read off a CharacterTag row instead of Character.resources.
        if (row.kind === "OBOL") {
          if (!obolTag) {
            await tx.pendingTax.update({
              where: { id: row.id },
              data: { appliedAmount: 0, skippedReason: "gone" },
            });
            return { moved: 0, skipped: true };
          }
          const held = await tx.characterTag.findUnique({
            where: { characterId_tagId: { characterId: row.targetId, tagId: obolTag.id } },
            select: { quantity: true },
          });
          const amount = Math.min(row.paidAmount ?? row.amount, held?.quantity ?? 0);
          if (amount <= 0) {
            await tx.pendingTax.update({
              where: { id: row.id },
              data: { appliedAmount: 0, skippedReason: "broke" },
            });
            return { moved: 0, skipped: true };
          }
          // `econ`, not a from/to override: same reason/actionType the ⬢
          // branch stamps on its own applyTransfer, so this reads as TAX on
          // /gm/economy instead of falling through to UNATTRIBUTED — the
          // fate of every OTHER tag hand-over in the game (Transfer, Loot),
          // which is a pre-existing gap this file has no reason to repeat.
          const econ = { reason: "TAX", actionType: "taxes_collected", turnId: turn.id, turnNumber: turn.number };
          await dropCharacterTag(tx, row.targetId, obolTag.id, amount, { source: "EVENT", econ });
          await addToStack(tx, row.taxerId, obolTag.id, amount, { stackable: true, source: "EVENT", econ });
          await tx.pendingTax.update({ where: { id: row.id }, data: { appliedAmount: amount } });
          return { moved: amount, skipped: false };
        }

        // The clamp: a target who spent down since filing pays what they
        // have rather than voiding the whole tax. Read inside this same
        // transaction the debit runs in — applyTransfer's conditional
        // updateMany is still the actual guard against a concurrent write,
        // this just decides the amount.
        // A Partial answer replaces what is owed; null means the full tax.
        const amount = Math.min(row.paidAmount ?? row.amount, from.balance);
        if (amount <= 0) {
          await tx.pendingTax.update({
            where: { id: row.id },
            data: { appliedAmount: 0, skippedReason: "broke" },
          });
          return { moved: 0, skipped: true };
        }

        await applyTransfer(tx, { from, to, amount }, { reason: "TAX", actionType: "taxes_collected", turnId: turn.id, turnNumber: turn.number });
        await tx.pendingTax.update({ where: { id: row.id }, data: { appliedAmount: amount } });
        return { moved: amount, skipped: false };
      });

      if (!outcome) continue; // claimed by a concurrent resume; not ours
      if (outcome.skipped) skipped += 1;
      else {
        applied += 1;
        moved += outcome.moved;
      }
    } catch (err) {
      if (err instanceof InsufficientResourcesError) {
        skipped += 1;
        continue;
      }
      failures.push({ id: row.id, error: err.message ?? String(err) });
    }
  }

  return { turnNumber: turn.number, applied, skipped, moved, failures };
}

module.exports = { runTaxPass };
