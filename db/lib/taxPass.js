// What a filed tax actually DOES: moves ⬢ or Obols from the target to the taxer, unless refused — the close-of-turn half of Taxman (docs/tags.yaml's `taxman`; db/lib/tax.js files the row, this resolves it). Run from db/index.js#resolveNeeds().
// Slot: right after "stagedPush", before "tagExpiry" — after autoLabor (taxes what the day earned) and a GM's own staged adjudication, and BEFORE "hunger" (a tax is the same kind of levy).
// ONE TRANSACTION PER ROW, never one around the whole batch (stagedPush.js's rule): a bad row must not roll back the others.
// CATATONIC IS NOT SPECIAL-CASED, ANYWHERE IN THIS FILE, AND MUST STAY THAT WAY — a Catatonic target simply never clicks Refuse. Adding an `if (catatonic)` branch would invent a permission this tag was never meant to carry.
const { resolveParty } = require("./parties");
const { applyTransfer, InsufficientResourcesError } = require("./resourceTransfer");
const { addToStack, dropCharacterTag } = require("./tagWrites");
const { OBOL_SLUG } = require("./depotState");

async function runTaxPass(prisma, turn) {
  const rows = await prisma.pendingTax.findMany({
    where: { turnId: turn.id, appliedAt: null, declinedAt: null },
    orderBy: { createdAt: "asc" },
  });
  // Only matters for an OBOL row — cheap to fetch unconditionally rather than branch.
  const obolTag = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } });

  let applied = 0;
  let skipped = 0;
  let moved = 0;
  const failures = [];

  for (const row of rows) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // The claim IS the double-apply guard, and it re-checks declinedAt: a refusal landing between findMany and here still wins.
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

        // Obols are a physical Tag stack (DEPOT.md), not a balance column, so they move through the tag primitives instead of applyTransfer — same clamp rule, read off a CharacterTag row instead.
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
          // `econ` stamps the same reason/actionType the ⬢ branch does, so this reads as TAX on /gm/economy instead of falling through to UNATTRIBUTED.
          const econ = { reason: "TAX", actionType: "taxes_collected", turnId: turn.id, turnNumber: turn.number };
          await dropCharacterTag(tx, row.targetId, obolTag.id, amount, { source: "EVENT", econ });
          await addToStack(tx, row.taxerId, obolTag.id, amount, { stackable: true, source: "EVENT", econ });
          await tx.pendingTax.update({ where: { id: row.id }, data: { appliedAmount: amount } });
          return { moved: amount, skipped: false };
        }

        // The clamp: a target who spent down since filing pays what they have rather than voiding the whole tax. applyTransfer's conditional updateMany is still the actual guard against a concurrent write.
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
