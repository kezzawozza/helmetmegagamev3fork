// Reconstructs the economy ledger from AuditLog rows written before the
// ledger existed. `npm run db:backfill-economy` to preview, `-- --apply` to
// write. Additive only, and safe to re-run — each row carries a backfillKey
// of `<auditLogId>:<n>` under a PARTIAL unique index.
//
// Two passes: (1) walk the audit log oldest-first, emitting what
// db/lib/economyAdapter.js can read out of each `details` blob; (2) compare
// every account's reconstructed sum against its LIVE balance and write one
// PLUG row for the difference — not a fudge, the honest half, since a
// perfect reconstruction doesn't exist (hunger/horse-upkeep/tax/carry
// recorded totals not deltas). A plug's size is a diagnostic, not real
// history (ECONOMY.md §6) — nobody should mistake it for either.
require("dotenv").config();
const { prisma } = require("../../index");
const { adapt } = require("../../lib/economyAdapter");
const { resourcesByCharacterIds, resourcesByRoomIds } = require("../../lib/resourceStack");

const BATCH = 500;

// AuditLog.turnId is null on most rows; turn comes from createdAt instead (/gm/audit does too).
function turnAt(turns, when) {
  let found = null;
  for (const t of turns) {
    if (t.startedAt <= when) found = t;
    else break;
  }
  return found;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const state = await prisma.gameState.findFirst({ select: { gameId: true } });
  if (!state?.gameId) {
    console.error("No current game. Nothing to backfill.");
    process.exitCode = 1;
    return;
  }
  const gameId = state.gameId;
  const turns = await prisma.turn.findMany({ orderBy: { number: "asc" }, select: { id: true, number: true, startedAt: true } });

  let scanned = 0;
  let written = 0;
  let cursor = null;
  const skippedTypes = new Map();

  for (;;) {
    const page = await prisma.auditLog.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, actionType: true, details: true, targetCharacterId: true, actorDiscordUserId: true, createdAt: true, locationId: true, roomId: true },
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    scanned += page.length;

    const rows = [];
    for (const entry of page) {
      const moves = adapt(entry);
      if (!moves.length) {
        skippedTypes.set(entry.actionType, (skippedTypes.get(entry.actionType) ?? 0) + 1);
        continue;
      }
      const turn = turnAt(turns, entry.createdAt);
      moves.forEach((m, i) => {
        rows.push({
          gameId,
          at: entry.createdAt,
          turnId: turn?.id ?? null,
          turnNumber: turn?.number ?? null,
          fromKind: m.from?.kind ?? null,
          fromId: m.from?.id ?? null,
          fromName: m.from?.name ?? null,
          toKind: m.to?.kind ?? null,
          toId: m.to?.id ?? null,
          toName: m.to?.name ?? null,
          form: m.form,
          amount: m.amount,
          reason: m.reason,
          actionType: entry.actionType,
          auditLogId: entry.id,
          actorDiscordUserId: entry.actorDiscordUserId ?? null,
          locationId: entry.locationId ?? null,
          roomId: entry.roomId ?? null,
          secret: Boolean(m.secret),
          source: "BACKFILL",
          backfillKey: `${entry.id}:${i}`,
        });
      });
    }

    if (rows.length) {
      written += rows.length;
      if (apply) await prisma.economyEntry.createMany({ data: rows, skipDuplicates: true }); // partial unique on backfillKey rejects reruns
    }
  }

  // --- pass 2: the plugs ---
  let plugs = [];
  if (apply) {
    plugs = await writePlugs(gameId);
  }

  const top = [...skippedTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`\nScanned ${scanned} audit row(s).`);
  console.log(`${apply ? "Wrote" : "Would write"} ${written} economy entr${written === 1 ? "y" : "ies"}.`);
  if (apply) console.log(`Wrote ${plugs.length} reconciliation plug(s).`);
  if (top.length) {
    console.log(`\nUnmapped action types (no ⬢ recoverable from their details), by volume:`);
    for (const [type, count] of top) console.log(`  ${String(count).padStart(6)}  ${type}`);
    console.log(`\nMost of these genuinely moved no money. The ones that did are what the plugs cover.`);
  }
  if (!apply) console.log(`\nDry run. Re-run with -- --apply to write.`);
}

// One row per account whose reconstructed sum does not match its live balance.
async function writePlugs(gameId) {
  const legs = await prisma.$queryRaw`
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
    ) legs GROUP BY kind, id`;
  const booked = new Map(legs.map((r) => [`${r.kind}:${r.id}`, Number(r.delta) || 0]));

  const [chars, rooms] = await Promise.all([
    prisma.character.findMany({ select: { id: true, name: true } }),
    prisma.room.findMany({ select: { id: true, name: true } }),
  ]);
  // ⬢ live in a CharacterTag/RoomTag stack row now (db/lib/resourceStack.js),
  // not a `resources` column — one batch read apiece instead of a select.
  const [charBalances, roomBalances] = await Promise.all([
    resourcesByCharacterIds(prisma, chars.map((c) => c.id)),
    resourcesByRoomIds(prisma, rooms.map((r) => r.id)),
  ]);

  const rows = [];
  for (const [kind, list, balances] of [["character", chars, charBalances], ["room", rooms, roomBalances]]) {
    for (const row of list) {
      const live = balances.get(row.id) ?? 0;
      const drift = live - (booked.get(`${kind}:${row.id}`) ?? 0);
      if (!drift) continue;
      const party = { kind, id: row.id, name: row.name };
      rows.push({
        gameId,
        fromKind: drift > 0 ? "world" : kind,
        fromId: drift > 0 ? "mint" : row.id,
        fromName: drift > 0 ? "Minted" : row.name,
        toKind: drift > 0 ? kind : "world",
        toId: drift > 0 ? row.id : "burn",
        toName: drift > 0 ? row.name : "Burned",
        form: "BALANCE",
        amount: Math.abs(drift),
        reason: "PLUG",
        source: "PLUG",
        backfillKey: `plug:${kind}:${party.id}`,
      });
    }
  }
  if (rows.length) await prisma.economyEntry.createMany({ data: rows, skipDuplicates: true });
  return rows;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
