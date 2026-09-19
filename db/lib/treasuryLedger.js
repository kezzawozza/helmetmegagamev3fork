// What the Meister's terminal (/treasury) can see of the bank's history.
//
// Only the General manifest's side of it: deposits, withdrawals, opening
// balances, settled sales and orders made wholly of General wares. The Black
// Market and the Merchant's shelves are not the Keep's business, so an order
// with even one line from them is left out whole, and so is a sale into the
// Merchant's books and his credit line. See docs/systemdocs/DEPOT.md §0h.
//
// Built at read time from three places, because no one table knows both the
// money and the manifest. Takes `prisma` as a parameter, the db/lib/dm.js
// convention.

const { manifestOf, MANIFEST_GENERAL } = require("./depotManifests");
const { readGameState } = require("./gameState");

const LIMIT = 500;

const LEDGER_KINDS = {
  BANK_DEPOSIT: "Deposit",
  BANK_WITHDRAWAL: "Withdrawal",
  CHARACTER_START: "Opening balance",
};

function linesOf(order) {
  return Array.isArray(order.lines) ? order.lines : [];
}

// A Resources line carries no tagId (depot/actions.js packs it by hand) and is
// on the General manifest. Never trust `order.manifestId`: it records the LAST
// ware carted, so a mixed cart can read "general".
function isGeneralOrder(order, tagsById) {
  return linesOf(order).every((line) => {
    if (!line?.tagId) return true;
    const tag = tagsById.get(line.tagId);
    return Boolean(tag) && manifestOf(tag) === MANIFEST_GENERAL;
  });
}

async function loadTreasuryTransactions(prisma, { accountId = null } = {}) {
  const state = await readGameState(prisma, { gameId: true });
  const gameId = state?.gameId ?? null;

  const bankEnd = accountId
    ? [
        { fromKind: "bank", fromId: accountId },
        { toKind: "bank", toId: accountId },
      ]
    : [{ fromKind: "bank" }, { toKind: "bank" }];

  const [entries, orders, sales, accounts] = await Promise.all([
    gameId
      ? prisma.economyEntry.findMany({
          where: { gameId, form: "ACCOUNT", reason: { in: Object.keys(LEDGER_KINDS) }, OR: bankEnd },
          orderBy: { at: "desc" },
          take: LIMIT,
        })
      : [],
    prisma.depotOrder.findMany({
      // An anonymous order stays out of its own account's view: the account
      // table names every fingerprint, so showing it there would unmask it.
      // A custom label hides the name the same way, so it stays out too.
      where: accountId ? { accountId, anonymous: false, label: null } : {},
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    }),
    prisma.depotSale.findMany({
      where: { settledAt: { not: null }, destination: { not: "MERCHANT" }, ...(accountId ? { accountId } : {}) },
      orderBy: { settledAt: "desc" },
      take: LIMIT,
    }),
    prisma.bankAccount.findMany({ select: { id: true, class: true, fingerprint: true, holderName: true } }),
  ]);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const tagIds = [...new Set(orders.flatMap((o) => linesOf(o).map((l) => l?.tagId).filter(Boolean)))];
  const tags = tagIds.length
    ? await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, manifest: true } })
    : [];
  const tagsById = new Map(tags.map((t) => [t.id, t]));

  const rows = [];

  for (const e of entries) {
    const credit = e.toKind === "bank";
    const id = credit ? e.toId : e.fromId;
    const account = accountsById.get(id);
    rows.push({
      id: `e:${e.id}`,
      kind: LEDGER_KINDS[e.reason],
      turn: e.turnNumber,
      at: e.at,
      accountId: id,
      accountClass: account?.class ?? "",
      fingerprint: account?.fingerprint ?? "",
      holderName: account?.holderName ?? (credit ? e.toName : e.fromName) ?? "",
      amount: credit ? e.amount : -e.amount,
      detail: "",
    });
  }

  for (const o of orders) {
    if (!isGeneralOrder(o, tagsById)) continue;
    const hidden = o.anonymous || Boolean(o.label);
    rows.push({
      id: `o:${o.id}`,
      kind: "Order",
      turn: o.placedTurn,
      at: o.createdAt,
      accountId: hidden ? null : o.accountId,
      accountClass: hidden ? "" : (accountsById.get(o.accountId)?.class ?? ""),
      fingerprint: hidden ? "" : o.fingerprint,
      holderName: o.label ? `"${o.label}"` : o.anonymous ? "Anonymous" : o.holderName,
      amount: -o.totalObols,
      detail: linesOf(o)
        .map((l) => `${l.quantity} × ${l.name}`)
        .join(", "),
    });
  }

  for (const s of sales) {
    const toVault = s.destination === "TREASURY";
    rows.push({
      id: `s:${s.id}`,
      kind: "Sale",
      turn: s.settledTurn,
      at: s.settledAt,
      accountId: s.accountId,
      accountClass: accountsById.get(s.accountId)?.class ?? "",
      fingerprint: s.fingerprint,
      holderName: s.holderName,
      amount: s.netObols ?? 0,
      detail: `${s.quantity} × ${s.tagName} — ${s.grossObols ?? 0} ¢ less ${s.taxObols ?? 0} ¢ tax${toVault ? ", paid to the treasury" : ""}`,
    });
  }

  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  return rows.slice(0, LIMIT);
}

module.exports = { loadTreasuryTransactions };
