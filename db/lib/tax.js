// The tax button's back half: filing a PendingTax row per target and
// answering the Refuse click (docs/tags.yaml's `taxman` description,
// TaxDialog.js). Resolving the filed rows at turn close is db/lib/taxPass.js
// — this file only covers "file it" and "refuse it".
//
// Takes `prisma` as a parameter and is deliberately not on the @lifeweb/db
// barrel; require it by path, the db/lib/dm.js convention.
const { DM_ACTION, dmAction } = require("./dmActions");

const PENDING_TAX_DECLINE_PREFIX = "tax-decline:";
const PENDING_TAX_PARTIAL_PREFIX = "tax-partial:";

// What the amount reads as, for the DM and the "you pay" line — the only two
// places a filed tax's currency turns into words. Obols get no glyph (they
// aren't the resources ledger — DEPOT.md), just the plain word.
function taxUnit(kind, amount) {
  return kind === "OBOL" ? `${amount} obol${amount === 1 ? "" : "s"}` : `${amount} ⬢`;
}

// Bascinet's words, verbatim, with the currency swapped in.
function taxDmText({ taxerName, taxerRole, amount, kind }) {
  return (
    `You were taxed by ${taxerName}, the ${taxerRole}. You may refuse.\n` +
    `-# You are being taxed for ${taxUnit(kind, amount)}. The tax will land at the end of the turn.`
  );
}

// Raw component JSON, the same shape as db/lib/lobby.js#declineComponents —
// one button, and it is the decline. The web draws the same pair off
// DM_ACTION_LABELS; only Discord needs the row built by hand.
function taxDeclineComponents(pendingTaxId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `${PENDING_TAX_DECLINE_PREFIX}${pendingTaxId}`, label: "Refuse" },
        { type: 2, style: 2, custom_id: `${PENDING_TAX_PARTIAL_PREFIX}${pendingTaxId}`, label: "Partial" },
      ],
    },
  ];
}

// Files one PendingTax row per target, inside one transaction, plus one
// tax_filed AuditLog row per target (a straight record, not a cooldown clock
// — the cooldown is tax_refused, written only on decline).
//
// `targets` is [{ id, discordUserId, name, amount, kind }], already validated
// and clamped by the caller (taxRequestImpl re-derives the roster
// server-side — see requestActions.js). `kind` defaults to "RESOURCES" for a
// caller that never heard of Obols. Returns the DM payloads for the caller's
// after().
async function fileTax(prisma, { taxer, taxerRole, turn, targets }) {
  const rows = [];
  await prisma.$transaction(async (tx) => {
    for (const target of targets) {
      const kind = target.kind ?? "RESOURCES";
      const row = await tx.pendingTax.create({
        data: {
          turnId: turn.id,
          taxerId: taxer.id,
          targetId: target.id,
          factionId: taxer.factionId,
          taxerRole,
          amount: target.amount,
          kind,
        },
      });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: taxer.discordUserId,
          actionType: "tax_filed",
          targetCharacterId: target.id,
          turnId: turn.id,
          details: { amount: target.amount, kind, factionId: taxer.factionId, taxerRole, pendingTaxId: row.id },
        },
      });
      rows.push(row);
    }
  });

  const dms = rows
    .map((row) => {
      const target = targets.find((t) => t.id === row.targetId);
      if (!target?.discordUserId) return null;
      return {
        discordUserId: target.discordUserId,
        content: taxDmText({ taxerName: taxer.name, taxerRole, amount: row.amount, kind: row.kind }),
        components: taxDeclineComponents(row.id),
        meta: dmAction(DM_ACTION.PENDING_TAX, row.id),
      };
    })
    .filter(Boolean);

  return { rows, dms };
}

const GONE = "That offer's gone.";
const NOT_YOURS = "That's not yours to answer.";

// The Refuse click. One button, and it always declines — there is no accept,
// the same LOBBY_SEAT shape (declineAssignment is the direct template).
//
// Also declines every OTHER still-pending PendingTax against this same
// target filed this same turn: the lockout says nobody in the faction may
// retarget them, so a second officer's row filed in the same window can't
// beat the refusal to the wire.
// The row, if it is still open and the clicker is its target.
async function loadOwnTax(prisma, pendingTaxId, discordUserId) {
  const row = await prisma.pendingTax.findUnique({ where: { id: pendingTaxId } });
  if (!row) return { problem: GONE };
  const target = await prisma.character.findFirst({
    where: { id: row.targetId, status: "ALIVE" },
    select: { discordUserId: true },
  });
  if (!target || target.discordUserId !== discordUserId) return { problem: NOT_YOURS };
  if (row.declinedAt || row.appliedAt) return { problem: GONE };
  return { row };
}

// Writes the lockout row. A Partial answer writes the same actionType as a
// refusal on purpose: paying part is pushing back, and db/lib/taxTargets.js
// locks the taxer out on either.
function writeRefusalAudit(prisma, row, discordUserId, extra = {}) {
  return prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "tax_refused",
        targetCharacterId: row.targetId,
        turnId: row.turnId,
        details: { taxerId: row.taxerId, amount: row.amount, pendingTaxId: row.id, ...extra },
      },
    })
    .catch((err) => console.error("Tax refusal audit failed:", err));
}

// The Partial answer. 0 is a refusal. Anything above is clamped to the tax and
// becomes what the pass takes at close.
async function payPartialTax(prisma, { pendingTaxId, discordUserId, amount }) {
  const n = Number.parseInt(String(amount ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: "Enter a number." };
  if (n === 0) return refuseTax(prisma, { pendingTaxId, discordUserId });

  const { row, problem } = await loadOwnTax(prisma, pendingTaxId, discordUserId);
  if (problem) return { ok: false, reason: problem };
  if (row.paidAmount != null) return { ok: false, reason: GONE };
  const paid = Math.min(n, row.amount);

  const claim = await prisma.pendingTax.updateMany({
    where: { id: row.id, declinedAt: null, appliedAt: null, paidAmount: null },
    data: { paidAmount: paid },
  });
  if (claim.count === 0) return { ok: false, reason: GONE };

  await writeRefusalAudit(prisma, row, discordUserId, { paidAmount: paid });
  return { ok: true, line: `You pay ${taxUnit(row.kind, paid)}.` };
}

async function refuseTax(prisma, { pendingTaxId, discordUserId }) {
  const { row, problem } = await loadOwnTax(prisma, pendingTaxId, discordUserId);
  if (problem) return { ok: false, reason: problem };

  const claim = await prisma.pendingTax.updateMany({
    where: { id: row.id, declinedAt: null, appliedAt: null },
    data: { declinedAt: new Date(), skippedReason: "declined" },
  });
  if (claim.count === 0) return { ok: false, reason: GONE };

  await prisma.pendingTax.updateMany({
    where: { targetId: row.targetId, turnId: row.turnId, declinedAt: null, appliedAt: null, id: { not: row.id } },
    data: { declinedAt: new Date(), skippedReason: "declined" },
  });

  await writeRefusalAudit(prisma, row, discordUserId);

  return { ok: true, line: "You refuse." };
}

module.exports = {
  PENDING_TAX_DECLINE_PREFIX,
  PENDING_TAX_PARTIAL_PREFIX,
  taxDmText,
  taxDeclineComponents,
  fileTax,
  refuseTax,
  payPartialTax,
};
