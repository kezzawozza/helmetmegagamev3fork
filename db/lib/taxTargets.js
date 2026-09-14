// Who a Taxman can see and tax (docs/tags.yaml's `taxman` description,
// TaxDialog.js). Takes `prisma` as the first parameter, the db/lib/dm.js
// convention — the turn pass, the web action and the backfill script all
// want the same reading of "who is in my faction and where do they stand."
// Deliberately not on the @lifeweb/db barrel; require it by path.
//
// There is no "characters in my zone" helper anywhere else in the game —
// everything else is Location-grain (db/lib/presence.js). It needs none of
// that complexity here: Character.zoneId is already denormalized onto the
// row (every writer of locationId writes zoneId), so this is one flat,
// indexed query, not a join through Location.
const { isUnaffiliated } = require("./factionConstants");
const { CATATONIC_SLUG } = require("./constants");
const { OBOL_SLUG } = require("./depotState");

// One turn of quiet after a refusal (desireGates.js's `lockTurns` shape,
// lockTurns = 1): locked while the open turn is the one the refusal happened
// in, or the very next one. So a refusal in turn 5 blocks retargeting through
// the close of turn 6.
function isLockedOut(refusedTurnNumber, openTurnNumber) {
  return openTurnNumber != null && openTurnNumber <= refusedTurnNumber + 1;
}

// `taxer` needs { id, factionId, zoneId }. Returns every ALIVE member of the
// taxer's own real faction (read-only ⬢ visibility is faction-wide, per the
// tag's description) — `sameZone` and `lockedOut` say which of them can
// actually be picked.
async function taxRoster(prisma, taxer, { openTurnNumber = null } = {}) {
  if (!taxer?.factionId) return [];

  const faction = await prisma.faction.findUnique({
    where: { id: taxer.factionId },
    select: { slug: true },
  });
  if (isUnaffiliated(faction)) return [];

  const [catatonicTag, obolTag, members] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: CATATONIC_SLUG }, select: { id: true } }),
    prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } }),
    prisma.character.findMany({
      where: { factionId: taxer.factionId, status: "ALIVE", id: { not: taxer.id } },
      select: {
        id: true,
        name: true,
        roleTitle: true,
        resources: true,
        zoneId: true,
        isLeader: true,
        isTreasurer: true,
      },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  const memberIds = members.map((m) => m.id);
  const [catatonicIds, obolCounts, refusals] = await Promise.all([
    catatonicTag && memberIds.length
      ? prisma.characterTag
          .findMany({
            where: { characterId: { in: memberIds }, tagId: catatonicTag.id },
            select: { characterId: true },
          })
          .then((rows) => new Set(rows.map((r) => r.characterId)))
      : Promise.resolve(new Set()),
    // Obols are a physical Tag stack, not a balance column (DEPOT.md), so a
    // member's holding is a CharacterTag row rather than a field on the
    // character itself — read the same way the catatonic marker is.
    obolTag && memberIds.length
      ? prisma.characterTag
          .findMany({
            where: { characterId: { in: memberIds }, tagId: obolTag.id },
            select: { characterId: true, quantity: true },
          })
          .then((rows) => new Map(rows.map((r) => [r.characterId, r.quantity])))
      : Promise.resolve(new Map()),
    memberIds.length
      ? prisma.auditLog.findMany({
          where: { actionType: "tax_refused", targetCharacterId: { in: memberIds } },
          select: { targetCharacterId: true, turnId: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  // AuditLog.turnId is a bare column, not a relation (log-table convention —
  // see PendingTax's own comment on why a FK isn't always the shape), so the
  // turn numbers are resolved in one extra batch rather than a nested select.
  const refusalTurnIds = [...new Set(refusals.map((r) => r.turnId).filter(Boolean))];
  const turnNumberById = refusalTurnIds.length
    ? new Map(
        (
          await prisma.turn.findMany({ where: { id: { in: refusalTurnIds } }, select: { id: true, number: true } })
        ).map((t) => [t.id, t.number]),
      )
    : new Map();

  // Latest refusal per target — orderBy above means the first hit per id wins.
  const latestRefusalTurn = new Map();
  for (const row of refusals) {
    if (!latestRefusalTurn.has(row.targetCharacterId) && row.turnId) {
      latestRefusalTurn.set(row.targetCharacterId, turnNumberById.get(row.turnId));
    }
  }

  return members.map((m) => ({
    id: m.id,
    name: m.name,
    roleTitle: m.roleTitle,
    resources: m.resources,
    obols: obolCounts.get(m.id) ?? 0,
    isLeader: m.isLeader,
    isTreasurer: m.isTreasurer,
    catatonic: catatonicIds.has(m.id),
    sameZone: taxer.zoneId != null && m.zoneId === taxer.zoneId,
    lockedOut: latestRefusalTurn.has(m.id)
      ? isLockedOut(latestRefusalTurn.get(m.id), openTurnNumber)
      : false,
  }));
}

// What the taxer's own filings this turn came to, for the Tax dialog's
// "This turn" panel. `status` is "pending" | "refused" | "partial".
async function taxesFiledThisTurn(prisma, taxerId, turnId) {
  if (!taxerId || !turnId) return [];
  const rows = await prisma.pendingTax.findMany({
    where: { taxerId, turnId },
    select: {
      id: true,
      amount: true,
      paidAmount: true,
      declinedAt: true,
      kind: true,
      target: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.target?.name ?? "",
    amount: r.amount,
    paidAmount: r.paidAmount,
    kind: r.kind,
    status: r.declinedAt ? "refused" : r.paidAmount != null ? "partial" : "pending",
  }));
}

module.exports = {
  taxRoster,
  taxesFiledThisTurn,
};
