import { prisma } from "@lifeweb/db";
import { reasonFlow, reasonLabel, FLOW } from "@lifeweb/db/lib/economyReasons";
import { creditAvailableObols } from "@lifeweb/db/lib/depotState";

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

// Every status whose ⬢ are real. CURSED used to be missing here and present in
// reconcile(), so a cursed purse counted as drift on Health and was invisible
// in the supply total a GM would open to check that drift against. The money
// exists; the books see it. Gini is the one deliberate exception — it asks
// about inequality among the living and stays ALIVE-only.
export const HOLDING_STATUSES = ["ALIVE", "DEAD", "CURSED"];

// --- live state ---------------------------------------------------------

// The money supply, right now, by form. This is read from the balances
// themselves rather than summed out of the ledger on purpose: it is the
// number the ledger gets checked AGAINST.
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

  // Bounded. Unbounded, this returned a row for every account holding any ⬢ —
  // which before a backfill is all of them — and shipped the lot to the client
  // on the FRONT PAGE, where the badge then read as a catastrophe on day one.
  //
  // `backfilled` is what tells those two states apart: with no ledger history
  // at all, every account "drifts" by its whole balance and the honest reading
  // is "nothing has been booked yet", not "the books are broken".
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

// --- reading the book ---------------------------------------------------

// The zone filter as a Prisma WHERE fragment rather than a post-filter.
//
// This has to happen in the query, not after it. Filtering a page of rows
// AFTER fetching it leaves the count and the page boundaries describing the
// unscoped table: a zone-restricted GM gets a "page 3 of 40" that is neither,
// and pages that render half empty.
//
// Filters on zoneId, not zoneName. The ledger stamps the id straight off the
// party it was handed (db/lib/parties.js already selects it), so there is no
// name to resolve at write time — and db/lib/gmZoneView.js#visibleZoneIds
// already folds a seat onto the cave levels it owns, which the name side has
// to redo by hand. Null means every zone, and a row with no zone stays visible
// to everyone, both the same rules inVisibleZones holds for the in-memory
// lists.
export function zoneWhere(visibleZoneIds) {
  if (!visibleZoneIds) return {};
  const ids = [...visibleZoneIds];
  if (!ids.length) return {};
  return { OR: [{ zoneId: null }, { zoneId: { in: ids } }] };
}

// One page of entries. Server-side paged, the /gm/audit posture, because this
// table is the longest thing in the game by the end of a month.
//
// `visibleZoneIds` is folded into the WHERE so the count and the paging
// describe what this GM can actually see.
export async function ledgerPage({ gameId, page = 1, pageSize = 50, where = {}, visibleZoneIds = null }) {
  const skip = (Math.max(1, page) - 1) * pageSize;
  const filter = { gameId, ...where, ...zoneWhere(visibleZoneIds) };
  const [rows, total] = await Promise.all([
    prisma.economyEntry.findMany({ where: filter, orderBy: { at: "desc" }, skip, take: pageSize }),
    prisma.economyEntry.count({ where: filter }),
  ]);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Per-turn totals for the charts, grouped straight off the ledger.
//
// There was an EconomyTurnRollup cache here for a while. It is gone: nothing
// ever built it during play, so in a live game it was empty or stale, and the
// one button that refreshed it silently dropped every row with no turn number
// — which is most of them — permanently shrinking the charts of whoever
// pressed it. A cache that is never written is not a cache, it is a second
// answer to the same question. If this groupBy ever gets slow, cache it
// somewhere that is actually kept warm.
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

// --- flows: who trades with whom ----------------------------------------

// The biggest character<->room hand-overs in a turn range, for the ArcWeb
// "who trades with whom" chart. Grouped straight off the snapshot columns
// (fromName/toName), the same reason `ledgerPage` never joins back to
// Character/Room: those rows can outlive the account they named.
//
// `form: "BALANCE"` only — a GOODS or COIN transfer is a different kind of
// hand-over, and mixing the two would sum ⬢ against item counts.
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

// --- goods -----------------------------------------------------------------

// Every priced tag in the world, with how much of it exists and how much of
// it has ever moved through the ledger. One groupBy per side (held, stashed,
// traded) rather than a query per tag — the same posture as
// goodsValueInWorld above.
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

// --- the Depot's books ------------------------------------------------

// The Depot singleton plus what a GM actually wants to read off it: how much
// credit is left, and what the outstanding manifest is worth. Returns nulls
// rather than zeros when there is no Depot row yet, so the section can tell
// "not provisioned" from "provisioned and empty".
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

// --- faction treasuries --------------------------------------------------

// Every faction's silo balance — the Room it banks in, per FACTIONS.md/
// CARRY.md ("there is no faction-level balance"). Follows the inline
// siloRoom-include pattern web/app/(app)/faction/page.js already uses rather
// than inventing a second shape for the same relation.
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
