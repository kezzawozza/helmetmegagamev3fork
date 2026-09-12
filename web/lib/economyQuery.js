import { prisma } from "@lifeweb/db";
import { reasonFlow, reasonLabel, FLOW } from "@lifeweb/db/lib/economyReasons";
import { inVisibleZones } from "./zones";

// The read side of the economy ledger — everything /gm/economy asks the
// database, in one place. Nothing here writes.
//
// Two rules run through all of it:
//
//   1. AGGREGATES STAY WHOLE. A GM who cannot see the Caves still sees the
//      Caves' ⬢ in the total supply, because the moment a total starts
//      depending on who is looking, every number on the page becomes a
//      different number per reader and the books stop balancing. Zone scoping
//      and redaction hide WHO, never HOW MUCH.
//   2. The ledger is a record, not a balance. Live balances are read straight
//      off Character/Room/Depot; the ledger's job is to be COMPARED against
//      them (see reconcile below), and a drift is the finding, not a bug to
//      paper over.

// What a plain GM is shown instead of a name they are not entitled to. The
// same word web/app/components/remarkDiscord.js already prints for a mention
// it will not resolve, so the panel speaks the language the rest of the app
// speaks.
const REDACTED = "someone";

// --- live state ---------------------------------------------------------

// The money supply, right now, by form. This is read from the balances
// themselves rather than summed out of the ledger on purpose: it is the
// number the ledger gets checked AGAINST.
export async function liveSupply() {
  const [chars, rooms, depot, coin, goods] = await Promise.all([
    prisma.character.aggregate({ _sum: { resources: true }, where: { status: { in: ["ALIVE", "DEAD"] } } }),
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
    // Debt is money the station owes, so it comes off the top. Goods are
    // valued, not minted, and are reported beside the total rather than inside
    // it — a town's larder is wealth, but calling it money supply would make
    // every crafted loaf look like inflation.
    total: balance + coin + account + manifest - debt,
  };
}

// Physical obols, on sheets and in stashes. One obol is one ⬢ (DEPOT.md), so
// the count IS the value.
async function coinInWorld() {
  const [held, stashed] = await Promise.all([
    prisma.characterTag.aggregate({ _sum: { quantity: true }, where: { tag: { slug: "obol" } } }),
    prisma.roomTag.aggregate({ _sum: { quantity: true }, where: { tag: { slug: "obol" } } }),
  ]);
  return (held._sum.quantity ?? 0) + (stashed._sum.quantity ?? 0);
}

// Every priced tag in the world at its catalog value. Deliberately excludes
// the obol, which is counted as COIN above and would otherwise be double
// counted.
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

// An order paid for but not yet landed. Money already gone from the account,
// so it belongs in the supply — it is somewhere, just not here yet.
function manifestValue(manifest) {
  if (!Array.isArray(manifest)) return 0;
  return manifest.reduce((n, l) => n + (Number(l?.quantity) || 0) * (Number(l?.unitPrice) || 0), 0);
}

// --- the invariant ------------------------------------------------------

// For every account: does the sum of its ledger legs equal its live balance?
//
// This is the panel's best feature and the reason the ledger is worth having.
// A non-zero drift means something moved money without telling the book — the
// Health section lists them, and the number is the size of the hole.
//
// PLUG rows are included on purpose. They exist precisely so the pre-ledger
// history closes, and excluding them would report every account as drifting by
// its opening balance.
export async function reconcile(gameId) {
  const [legs, chars, rooms] = await Promise.all([
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
    prisma.character.findMany({ select: { id: true, name: true, resources: true } }),
    prisma.room.findMany({ select: { id: true, name: true, resources: true } }),
  ]);

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
  return { rows, clean: rows.length === 0 };
}

// --- reading the book ---------------------------------------------------

// One page of entries. Server-side paged, the /gm/audit posture, because this
// table is the longest thing in the game by the end of a month.
export async function ledgerPage({ gameId, page = 1, pageSize = 50, where = {} }) {
  const skip = (Math.max(1, page) - 1) * pageSize;
  const filter = { gameId, ...where };
  const [rows, total] = await Promise.all([
    prisma.economyEntry.findMany({ where: filter, orderBy: { at: "desc" }, skip, take: pageSize }),
    prisma.economyEntry.count({ where: filter }),
  ]);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Per-turn totals for the charts. Reads the rollup when it has been built and
// falls back to the ledger when it has not, so a fresh install still draws
// something rather than an empty page.
export async function flowsByTurn({ gameId, fromTurn = null, toTurn = null }) {
  const turnFilter = {};
  if (fromTurn != null) turnFilter.gte = Number(fromTurn);
  if (toTurn != null) turnFilter.lte = Number(toTurn);
  const where = { gameId, ...(Object.keys(turnFilter).length ? { turnNumber: turnFilter } : {}) };

  const rollup = await prisma.economyTurnRollup.findMany({ where, orderBy: { turnNumber: "asc" } });
  if (rollup.length) return rollup;

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

// Mint, burn and hand-over per turn — the three lines on the Pulse chart.
// INTERNAL reasons are excluded from velocity: an ATM withdrawal is the same ⬢
// changing coat, and counting it as trade would make a quiet turn at the Depot
// look like a boom.
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

// --- concentration ------------------------------------------------------

// The Gini coefficient over live purses, and the Lorenz points to draw beside
// it. Answers "is one person sitting on everything", which is the question
// that makes a GM open this page in the first place.
//
// 0 is perfect equality, 1 is one person holding it all. An empty or
// all-zero world is reported as 0 rather than NaN.
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

// --- what a given GM may read ------------------------------------------

// Zone scoping, reusing the desks' own filter. `visibleZoneNames` null means
// every zone (web/lib/gmZoneView.js), and an entry with no zone stays visible
// to everyone — EconomyEntry.zoneName is named to match what inVisibleZones
// already reads, so no adapter is needed.
export function scopeToZones(rows, visibleZoneNames) {
  return inVisibleZones(rows, visibleZoneNames);
}

// Redaction. The amount, the reason and the turn always survive; only the
// counterparty is withheld, and only from a GM who is not a superadmin.
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
