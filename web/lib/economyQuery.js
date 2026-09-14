import { prisma } from "@lifeweb/db";
import { reasonFlow, reasonLabel, FLOW } from "@lifeweb/db/lib/economyReasons";
import { creditAvailableObols } from "@lifeweb/db/lib/depotState";

// The read side of the economy ledger — everything /gm/economy asks the
// database. Nothing here writes. Aggregates stay whole (zone scoping hides
// WHO, never HOW MUCH); the ledger is a record, COMPARED against live
// balances (reconcile below), so a drift is the finding, not a bug to hide.

// What a plain GM sees instead of a name they are not entitled to.
const REDACTED = "someone";

// Statuses whose ⬢ are real; CURSED included since that money still exists.
export const HOLDING_STATUSES = ["ALIVE", "DEAD", "CURSED"];

// The money supply, right now, by form — read from balances themselves,
// since this is the number the ledger gets checked AGAINST.
export async function liveSupply() {
  const [chars, rooms, depot, coin, goods] = await Promise.all([
    prisma.character.aggregate({ _sum: { resources: true }, where: { status: { in: HOLDING_STATUSES } } }),
    prisma.room.aggregate({ _sum: { resources: true } }),
    prisma.depot.findFirst({ select: { accountObols: true, debtObols: true, manifest: true } }),
    coinInWorld(),
    goodsValueInWorld(),
  ]);
  const balance = (chars._sum.resources ?? 0) + (rooms._sum.resources ?? 0);
  const account = depot?.accountObols ?? 0;
  const debt = depot?.debtObols ?? 0;
  const manifest = manifestValue(depot?.manifest);
  return {
    balance,
    coin,
    account,
    debt,
    manifest,
    goods,
    // Debt comes off the top; goods are reported beside the total, not in it.
    total: balance + coin + account + manifest - debt,
  };
}

// Physical obols. One obol is one ⬢ (DEPOT.md), so the count IS the value.
async function coinInWorld() {
  const [held, stashed] = await Promise.all([
    prisma.characterTag.aggregate({ _sum: { quantity: true }, where: { tag: { slug: "obol" } } }),
    prisma.roomTag.aggregate({ _sum: { quantity: true }, where: { tag: { slug: "obol" } } }),
  ]);
  return (held._sum.quantity ?? 0) + (stashed._sum.quantity ?? 0);
}

// Every priced tag at catalog value. Excludes obol (counted as COIN above).
async function goodsValueInWorld() {
  const priced = await prisma.tag.findMany({
    where: { OR: [{ sellablePrice: { not: null } }, { depotPrice: { not: null } }], slug: { not: "obol" } },
    select: { id: true, sellablePrice: true, depotPrice: true },
  });
  if (!priced.length) return 0;
  const ids = priced.map((t) => t.id);
  const price = new Map(priced.map((t) => [t.id, t.sellablePrice ?? t.depotPrice ?? 0]));
  const [held, stashed] = await Promise.all([
    prisma.characterTag.groupBy({ by: ["tagId"], _sum: { quantity: true }, where: { tagId: { in: ids } } }),
    prisma.roomTag.groupBy({ by: ["tagId"], _sum: { quantity: true }, where: { tagId: { in: ids } } }),
  ]);
  let n = 0;
  for (const row of [...held, ...stashed]) n += (row._sum.quantity ?? 0) * (price.get(row.tagId) ?? 0);
  return n;
}

// An order paid for but not yet landed — already gone from the account.
function manifestValue(manifest) {
  if (!Array.isArray(manifest)) return 0;
  return manifest.reduce((n, l) => n + (Number(l?.quantity) || 0) * (Number(l?.unitPrice) || 0), 0);
}

// Does the sum of each account's ledger legs equal its live balance? PLUG
// rows are included so pre-ledger history closes instead of every account
// drifting by its opening balance.
export async function reconcile(gameId, { limit = 50 } = {}) {
  const [legs, chars, rooms, booked] = await Promise.all([
    prisma.$queryRaw`
      SELECT kind, id, SUM(delta)::int AS delta FROM (
        SELECT "fromKind" AS kind, "fromId" AS id, -SUM("amount")::int AS delta
          FROM "EconomyEntry"
         WHERE "gameId" = ${gameId} AND "form" = 'BALANCE' AND "fromKind" IN ('character','room')
         GROUP BY 1, 2
        UNION ALL
        SELECT "toKind" AS kind, "toId" AS id, SUM("amount")::int AS delta
          FROM "EconomyEntry"
         WHERE "gameId" = ${gameId} AND "form" = 'BALANCE' AND "toKind" IN ('character','room')
         GROUP BY 1, 2
      ) legs GROUP BY kind, id`,
    prisma.character.findMany({ where: { status: { in: HOLDING_STATUSES } }, select: { id: true, name: true, resources: true } }),
    prisma.room.findMany({ select: { id: true, name: true, resources: true } }),
    prisma.economyEntry.count({ where: { gameId } }),
  ]);
  const backfilled = booked > 0;

  const ledger = new Map(legs.map((r) => [`${r.kind}:${r.id}`, Number(r.delta) || 0]));
  const rows = [];
  for (const [kind, list] of [["character", chars], ["room", rooms]]) {
    for (const row of list) {
      const booked = ledger.get(`${kind}:${row.id}`) ?? 0;
      const drift = row.resources - booked;
      if (drift !== 0) rows.push({ kind, id: row.id, name: row.name, live: row.resources, booked, drift });
    }
  }
  rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  // Bounded, since unbounded this shipped every holding account to the client.
  const total = rows.length;
  const drift = rows.reduce((n, r) => n + Math.abs(r.drift), 0);
  return {
    rows: rows.slice(0, limit),
    total,
    drift,
    truncated: total > limit,
    clean: total === 0,
    backfilled,
  };
}

// The zone filter as a Prisma WHERE fragment, not a post-filter — filtering
// after fetching leaves the count/page boundaries describing the unscoped
// table. Filters on zoneId (db/lib/parties.js stamps it at write time), not
// zoneName. Null means every zone; a row with no zone stays visible to all.
export function zoneWhere(visibleZoneIds) {
  if (!visibleZoneIds) return {};
  const ids = [...visibleZoneIds];
  if (!ids.length) return {};
  return { OR: [{ zoneId: null }, { zoneId: { in: ids } }] };
}

// One page of entries, server-side paged like /gm/audit; `visibleZoneIds`
// folds into the WHERE so the count and paging match what this GM can see.
export async function ledgerPage({ gameId, page = 1, pageSize = 50, where = {}, visibleZoneIds = null }) {
  const skip = (Math.max(1, page) - 1) * pageSize;
  const filter = { gameId, ...where, ...zoneWhere(visibleZoneIds) };
  const [rows, total] = await Promise.all([
    prisma.economyEntry.findMany({ where: filter, orderBy: { at: "desc" }, skip, take: pageSize }),
    prisma.economyEntry.count({ where: filter }),
  ]);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Per-turn totals for the charts, grouped straight off the ledger — no
// rollup cache; a cache nobody writes to is worse than none.
export async function flowsByTurn({ gameId, fromTurn = null, toTurn = null }) {
  const turnFilter = {};
  if (fromTurn != null) turnFilter.gte = Number(fromTurn);
  if (toTurn != null) turnFilter.lte = Number(toTurn);
  const where = { gameId, ...(Object.keys(turnFilter).length ? { turnNumber: turnFilter } : {}) };

  const grouped = await prisma.economyEntry.groupBy({
    by: ["turnNumber", "reason", "form", "fromKind", "toKind"],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });
  return grouped.map((g) => ({
    turnNumber: g.turnNumber,
    reason: g.reason,
    form: g.form,
    fromKind: g.fromKind,
    toKind: g.toKind,
    amount: g._sum.amount ?? 0,
    entryCount: g._count._all,
  }));
}

// Mint, burn and hand-over per turn, the three Pulse chart lines. INTERNAL
// reasons excluded: an ATM withdrawal is coat-changing, not trade.
export function supplySeries(rows) {
  const byTurn = new Map();
  for (const r of rows) {
    const t = r.turnNumber ?? 0;
    if (!byTurn.has(t)) byTurn.set(t, { turnNumber: t, minted: 0, burned: 0, moved: 0 });
    const bucket = byTurn.get(t);
    const flow = reasonFlow(r.reason);
    if (flow === FLOW.FAUCET || r.fromKind === "world") bucket.minted += r.amount;
    else if (flow === FLOW.SINK || r.toKind === "world") bucket.burned += r.amount;
    else if (flow === FLOW.TRANSFER) bucket.moved += r.amount;
  }
  const series = [...byTurn.values()].sort((a, b) => a.turnNumber - b.turnNumber);
  let running = 0;
  for (const p of series) {
    running += p.minted - p.burned;
    p.net = p.minted - p.burned;
    p.cumulative = running;
  }
  return series;
}

// Gini coefficient over live purses, plus Lorenz points. 0 is equal, 1 is
// one person holding it all; an all-zero world reports 0, not NaN.
export function gini(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  if (!n || total === 0) return { gini: 0, lorenz: [{ p: 0, q: 0 }, { p: 1, q: 1 }] };
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * xs[i];
  const g = (2 * weighted) / (n * total) - (n + 1) / n;
  const lorenz = [{ p: 0, q: 0 }];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += xs[i];
    lorenz.push({ p: (i + 1) / n, q: acc / total });
  }
  return { gini: Math.max(0, Math.min(1, g)), lorenz };
}

// Only the counterparty is withheld, and only from a non-superadmin GM.
export function redactEntry(entry, { unredacted = false } = {}) {
  const label = reasonLabel(entry.reason);
  if (unredacted || !entry.secret) return { ...entry, reasonLabel: label, redacted: false };
  return {
    ...entry,
    reasonLabel: label,
    fromName: entry.fromKind === "world" || entry.fromKind === "offworld" ? entry.fromName : REDACTED,
    toName: entry.toKind === "world" || entry.toKind === "offworld" ? entry.toName : REDACTED,
    fromId: null,
    toId: null,
    tagSlug: null,
    redacted: true,
  };
}

// The biggest character<->room hand-overs in a turn range, for the ArcWeb
// chart. `form: "BALANCE"` only — mixing GOODS/COIN would sum ⬢ against item counts.
export async function counterpartyEdges({ gameId, fromTurn = null, toTurn = null, limit = 40 }) {
  const turnFilter = {};
  if (fromTurn != null) turnFilter.gte = Number(fromTurn);
  if (toTurn != null) turnFilter.lte = Number(toTurn);
  const where = {
    gameId,
    form: "BALANCE",
    fromKind: { in: ["character", "room"] },
    toKind: { in: ["character", "room"] },
    ...(Object.keys(turnFilter).length ? { turnNumber: turnFilter } : {}),
  };
  const grouped = await prisma.economyEntry.groupBy({
    by: ["fromId", "fromName", "toId", "toName"],
    where,
    _sum: { amount: true },
  });
  return grouped
    .map((g) => ({ fromId: g.fromId, fromName: g.fromName, toId: g.toId, toName: g.toName, amount: g._sum.amount ?? 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// Every priced tag: how much exists, and how much has moved through the ledger.
export async function goodsCatalog() {
  const tags = await prisma.tag.findMany({
    where: {
      OR: [{ sellablePrice: { not: null } }, { depotPrice: { not: null } }],
      slug: { not: "obol" },
    },
    select: { id: true, slug: true, name: true, depotPrice: true, sellablePrice: true },
  });
  if (!tags.length) return [];
  const ids = tags.map((t) => t.id);

  const [held, stashed, traded] = await Promise.all([
    prisma.characterTag.groupBy({ by: ["tagId"], _sum: { quantity: true }, where: { tagId: { in: ids } } }),
    prisma.roomTag.groupBy({ by: ["tagId"], _sum: { quantity: true }, where: { tagId: { in: ids } } }),
    prisma.economyEntry.groupBy({ by: ["tagId"], _count: { _all: true }, where: { tagId: { in: ids }, form: "GOODS" } }),
  ]);
  const heldById = new Map(held.map((r) => [r.tagId, r._sum.quantity ?? 0]));
  const stashedById = new Map(stashed.map((r) => [r.tagId, r._sum.quantity ?? 0]));
  const tradedById = new Map(traded.map((r) => [r.tagId, r._count._all]));

  return tags.map((t) => {
    const spread =
      t.depotPrice != null && t.sellablePrice != null ? t.depotPrice - t.sellablePrice : null;
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      depotPrice: t.depotPrice,
      sellablePrice: t.sellablePrice,
      spread,
      inWorld: (heldById.get(t.id) ?? 0) + (stashedById.get(t.id) ?? 0),
      traded: tradedById.get(t.id) ?? 0,
    };
  });
}

// Returns nulls, not zeros, when there is no Depot row yet, so "not
// provisioned" reads apart from "provisioned and empty".
export async function depotBooks() {
  const depot = await prisma.depot.findFirst();
  if (!depot) {
    return {
      accountObols: null,
      debtObols: null,
      creditCapObols: null,
      creditAvailableObols: null,
      manifestLines: 0,
      manifestValue: 0,
    };
  }
  const manifest = Array.isArray(depot.manifest) ? depot.manifest : [];
  const manifestValueTotal = manifest.reduce(
    (n, l) => n + (Number(l?.quantity) || 0) * (Number(l?.unitPrice) || 0),
    0,
  );
  return {
    accountObols: depot.accountObols,
    debtObols: depot.debtObols,
    creditCapObols: depot.creditCapObols,
    creditAvailableObols: creditAvailableObols(depot),
    manifestLines: manifest.length,
    manifestValue: manifestValueTotal,
  };
}

// Every faction's silo balance — the Room it banks in (FACTIONS.md/CARRY.md).
export async function factionTreasuries() {
  const factions = await prisma.faction.findMany({
    select: {
      id: true,
      name: true,
      zone: { select: { name: true } },
      siloRoom: {
        select: {
          id: true,
          name: true,
          resources: true,
          location: { select: { zone: { select: { name: true } } } },
        },
      },
      _count: { select: { characters: true } },
    },
  });
  return factions.map((f) => ({
    id: f.id,
    name: f.name,
    zoneName: f.zone?.name ?? f.siloRoom?.location?.zone?.name ?? "",
    siloRoomId: f.siloRoom?.id ?? null,
    siloRoomName: f.siloRoom?.name ?? null,
    balance: f.siloRoom ? f.siloRoom.resources : null,
    memberCount: f._count.characters,
  }));
}
