import { redirect } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@lifeweb/db";
import { visibleZoneIds as loadVisibleZoneIds } from "@lifeweb/db/lib/gmZoneView";
import { reasonLabel, reasonFlow, FLOW, REASONS } from "@lifeweb/db/lib/economyReasons";
import { sankeyFromFlows, arcWebFromEdges } from "@lifeweb/db/lib/economyFlows";
import { RESOURCES_SELECT, resourcesOf } from "@lifeweb/db/lib/resourceStack";
import { trainHere } from "@lifeweb/db/lib/train";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import DeskHeader, { DeskTurnChip } from "@/app/components/DeskHeader";
import EconomyNav from "./EconomyNav";
import EconomyView from "./EconomyView";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { getVisibleZones } from "@/lib/gmZoneView";
import { getOpenTurn } from "@/lib/turn";
import { inVisibleZones } from "@/lib/zones";
import {
  liveSupply,
  flowsByTurn,
  supplySeries,
  gini,
  reconcile,
  ledgerPage,
  zoneWhere,
  redactEntry,
  HOLDING_STATUSES,
  counterpartyEdges,
  goodsCatalog,
  depotBooks,
  factionTreasuries,
} from "@/lib/economyQuery";

// /gm/economy — the GM analytics desk over EconomyEntry. See CLAUDE.md's
// economy task doc for the shape; this page owns section routing and the
// per-section data loads, following gm/dev/page.js's `?s=` switch so that
// opening the front page (Pulse) never touches the ledger table.
//
// AGGREGATES STAY WHOLE (economyQuery.js's own rule, restated here at every
// call site that could tempt a "fix"): liveSupply(), gini() and reconcile()
// are never zone-filtered. Only the row-level lists — the
// ledger page and the accounts roster — are. The moment a total depends on
// who is looking, the books stop balancing and the page starts lying.
async function currentGameId() {
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  return state?.gameId ?? null;
}

export default async function EconomyPage({ searchParams }) {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  const rawSearch = await searchParams;
  const section = rawSearch?.s || "pulse";
  const openTurn = await getOpenTurn();

  return (
    <div className="desk-shell">
      <DeskHeader title="Economy" meta={<DeskTurnChip turn={openTurn} />} />
      <div className="desk-body desk-body--ops">
        <EconomyNav section={section} />
        <main className="desk-main desk-main--ops">
          <SnapshotPage
            scope={`gm-economy:${section}`}
            userId={session.discordUserId}
            render={EconomyView}
            fallback={<EconomyLoading />}
          >
            <Suspense fallback={null}>
              <FreshEconomy section={section} searchParams={searchParams} userId={session.discordUserId} />
            </Suspense>
          </SnapshotPage>
        </main>
      </div>
    </div>
  );
}

function EconomyLoading() {
  return <p className="empty-state">Loading the books…</p>;
}

async function FreshEconomy({ section, searchParams, userId }) {
  // The (desk) layout already redirects a non-GM. Re-checked here anyway —
  // a layout gate is presentation, and this is the load that actually reads
  // the ledger.
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!isGm) redirect("/character");

  const unredacted = isSuperadmin(session.discordUserId);
  const gameId = await currentGameId();
  const visibleZones = await getVisibleZones();
  const visibleZoneNames = visibleZones?.map((z) => z.name) ?? null;
  // The ledger is keyed by zoneId, not name — zoneWhere/ledgerPage need the
  // id-based set. Accounts rows are character/room rows carrying a zone NAME,
  // so they keep using visibleZoneNames + inVisibleZones below.
  const zoneIds = await loadVisibleZoneIds(prisma, session.discordUserId);

  let data = { section, isSuperadmin: unredacted };

  if (!gameId) {
    // A fresh game (or one wiped and not yet started) has no GameState row
    // pointed at a Game with any entries. Every section below still needs to
    // render something sensible rather than throwing on a null gameId.
    data = { ...data, empty: true };
    return <SnapshotFresh scope={`gm-economy:${section}`} userId={userId} data={data} />;
  }

  switch (section) {
    case "pulse": {
      const openTurn = await getOpenTurn();
      const [supply, flowRows, aliveResources, reconciliation] = await Promise.all([
        liveSupply(),
        flowsByTurn({ gameId }),
        // Every ALIVE character, zeros included — a purse nobody holds is a
        // real data point for a Gini coefficient, and a ⬢ stack that hit zero
        // was deleted rather than kept as a 0 row.
        prisma.character.findMany({ where: { status: "ALIVE" }, select: { id: true, ...RESOURCES_SELECT } }),
        reconcile(gameId),
      ]);
      const series = supplySeries(flowRows);

      // Top movers this turn: net ⬢ change per character, character legs
      // only. Secret entries are dropped from this list entirely rather than
      // redacted-but-counted — a "top movers" list that names counterparties
      // is exactly the surface redactEntry exists to keep a secret entry out
      // of, and there is no honest anonymous way to rank one alongside named
      // rows.
      const turnEntries = openTurn
        ? await prisma.economyEntry.findMany({
            where: {
              gameId,
              turnNumber: openTurn.number,
              OR: [{ fromKind: "character" }, { toKind: "character" }],
              ...(unredacted ? {} : { secret: false }),
            },
            select: { fromKind: true, fromId: true, fromName: true, toKind: true, toId: true, toName: true, amount: true },
          })
        : [];
      const netByCharacter = new Map();
      for (const e of turnEntries) {
        if (e.fromKind === "character" && e.fromId) {
          const cur = netByCharacter.get(e.fromId) ?? { id: e.fromId, name: e.fromName, net: 0 };
          cur.net -= e.amount;
          netByCharacter.set(e.fromId, cur);
        }
        if (e.toKind === "character" && e.toId) {
          const cur = netByCharacter.get(e.toId) ?? { id: e.toId, name: e.toName, net: 0 };
          cur.net += e.amount;
          netByCharacter.set(e.toId, cur);
        }
      }
      const topMovers = [...netByCharacter.values()]
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
        .slice(0, 10);

      const { gini: giniValue, lorenz } = gini(aliveResources.map((c) => resourcesOf(c)));

      data = {
        ...data,
        supply,
        series: series.map((p) => ({
          turnNumber: p.turnNumber,
          minted: p.minted,
          burned: p.burned,
          moved: p.moved,
          net: p.net,
          cumulative: p.cumulative,
        })),
        gini: giniValue,
        lorenz,
        reconciliation,
        topMovers,
        openTurnNumber: openTurn?.number ?? null,
      };
      break;
    }

    case "ledger": {
      const raw = await searchParams;
      const page = Math.max(1, Number(raw?.page) || 1);
      const reason = raw?.reason || null;
      const where = reason ? { reason } : {};

      // Zone scoping goes INTO the query, not over the page that comes back.
      // Filtering afterwards would leave the count and the page boundaries
      // describing the unscoped table — "page 3 of 40" that is neither, and
      // pages that render half empty. The reason counts take the same filter,
      // so a chip never promises rows this GM cannot see.
      const zoneFilter = zoneWhere(zoneIds);
      const [pageResult, reasonCounts, allCount] = await Promise.all([
        ledgerPage({ gameId, page, pageSize: 50, where, visibleZoneIds: zoneIds }),
        prisma.economyEntry.groupBy({
          by: ["reason"],
          where: { gameId, ...zoneFilter },
          _count: { _all: true },
          orderBy: { _count: { reason: "desc" } },
        }),
        // The "All" chip's own count, unfiltered by reason — `pageResult.total`
        // is the count for the CURRENT reason filter, so reusing it here made
        // "All" read as whatever reason was last picked.
        prisma.economyEntry.count({ where: { gameId, ...zoneFilter } }),
      ]);

      const entries = pageResult.rows.map((row) => {
        const r = redactEntry(row, { unredacted: unredacted });
        return {
          id: r.id,
          // Seconds, not a Date — the same epoch DiscordTime already reads off
          // a `<t:EPOCH:style>` token, and a Date object cannot cross the
          // server/client boundary as anything but a string anyway.
          at: Math.floor(new Date(r.at).getTime() / 1000),
          turnNumber: r.turnNumber,
          reason: r.reason,
          reasonLabel: r.reasonLabel,
          fromKind: r.fromKind,
          fromId: r.fromId,
          fromName: r.fromName,
          toKind: r.toKind,
          toId: r.toId,
          toName: r.toName,
          amount: r.amount,
          form: r.form,
          tagSlug: r.tagSlug,
          quantity: r.quantity,
          auditLogId: r.auditLogId,
          secret: row.secret,
          redacted: r.redacted,
        };
      });

      data = {
        ...data,
        entries,
        total: pageResult.total,
        allCount,
        page: pageResult.page,
        pages: pageResult.pages,
        reasonFilter: reason,
        reasonCounts: reasonCounts.map((r) => ({ reason: r.reason, label: reasonLabel(r.reason), count: r._count._all })),
      };
      break;
    }

    case "accounts": {
      const openTurn = await getOpenTurn();
      const raw = await searchParams;
      const apage = Math.max(1, Number(raw?.apage) || 1);
      const kindFilter = raw?.kind || null;
      const zoneFilter2 = raw?.zone || null;
      const q = (raw?.q || "").trim().toLowerCase();

      const [chars, rooms, legs] = await Promise.all([
        // HOLDING_STATUSES, not ALIVE-only — a CURSED purse is real ⬢ and
        // used to be invisible here while still counting as drift on Health.
        prisma.character.findMany({
          where: { status: { in: HOLDING_STATUSES } },
          select: {
            id: true,
            name: true,
            status: true,
            ...RESOURCES_SELECT,
            faction: { select: { zone: { select: { name: true } } } },
            zone: { select: { name: true } },
          },
        }),
        prisma.room.findMany({
          select: {
            id: true,
            name: true,
            ...RESOURCES_SELECT,
            location: { select: { zone: { select: { name: true } } } },
          },
        }),
        // form = 'BALANCE' on both legs. Without it this summed BALANCE, COIN,
        // ACCOUNT and GOODS-at-catalog-price into one column sitting next to a
        // Balance column that is BALANCE only — a character who picked up two
        // loaves showed ⬢ inflow they never received.
        openTurn
          ? prisma.$queryRaw`
              SELECT kind, id, SUM(inflow)::int AS inflow, SUM(outflow)::int AS outflow FROM (
                SELECT "fromKind" AS kind, "fromId" AS id, 0 AS inflow, SUM("amount")::int AS outflow
                  FROM "EconomyEntry"
                 WHERE "gameId" = ${gameId} AND "turnNumber" = ${openTurn.number} AND "form" = 'BALANCE' AND "fromKind" IN ('character','room')
                 GROUP BY 1, 2
                UNION ALL
                SELECT "toKind" AS kind, "toId" AS id, SUM("amount")::int AS inflow, 0 AS outflow
                  FROM "EconomyEntry"
                 WHERE "gameId" = ${gameId} AND "turnNumber" = ${openTurn.number} AND "form" = 'BALANCE' AND "toKind" IN ('character','room')
                 GROUP BY 1, 2
              ) legs GROUP BY kind, id`
          : Promise.resolve([]),
      ]);

      const flowById = new Map(
        legs.map((l) => [`${l.kind}:${l.id}`, { inflow: Number(l.inflow) || 0, outflow: Number(l.outflow) || 0 }]),
      );

      const rows = [
        ...chars.map((c) => {
          const flow = flowById.get(`character:${c.id}`) ?? { inflow: 0, outflow: 0 };
          return {
            id: c.id,
            kind: "character",
            name: c.name,
            status: c.status,
            zoneName: c.faction?.zone?.name || c.zone?.name || "",
            balance: resourcesOf(c),
            inflow: flow.inflow,
            outflow: flow.outflow,
          };
        }),
        ...rooms.map((r) => {
          const flow = flowById.get(`room:${r.id}`) ?? { inflow: 0, outflow: 0 };
          return {
            id: r.id,
            kind: "room",
            name: r.name,
            status: null,
            zoneName: r.location?.zone?.name || "",
            balance: resourcesOf(r),
            inflow: flow.inflow,
            outflow: flow.outflow,
          };
        }),
      ];

      // Zone scoping stays NAME-based here — these are character/room rows,
      // not EconomyEntry rows, and inVisibleZones is what already folds a
      // seat onto the cave levels it owns on that side.
      const scoped = inVisibleZones(rows, visibleZoneNames);

      // The zone chip list, off the scoped rows so a GM never sees a zone
      // option for something they cannot open anyway.
      const zoneOptions = [...new Set(scoped.map((r) => r.zoneName).filter(Boolean))].sort();

      const filtered = scoped.filter((r) => {
        if (kindFilter && r.kind !== kindFilter) return false;
        if (zoneFilter2 && r.zoneName !== zoneFilter2) return false;
        if (q && !r.name.toLowerCase().includes(q)) return false;
        return true;
      });
      filtered.sort((a, b) => b.balance - a.balance);

      // Server-paged like the Ledger, not shipped whole for useTableState to
      // page client-side: Rooms are unbounded and grow with every zone
      // re-sync, so "every character AND every room" was a payload that only
      // ever grew.
      const pageSize = 50;
      const total = filtered.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const clampedPage = Math.min(apage, pages);
      const pageRows = filtered.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

      data = {
        ...data,
        rows: pageRows,
        total,
        page: clampedPage,
        pages,
        kindFilter,
        zoneFilter: zoneFilter2,
        q: raw?.q || "",
        zoneOptions,
        openTurnNumber: openTurn?.number ?? null,
      };
      break;
    }

    case "health": {
      const [reconciliation, unattributed, plugRows] = await Promise.all([
        reconcile(gameId),
        prisma.economyEntry.groupBy({
          by: ["actionType"],
          where: { gameId, reason: "UNATTRIBUTED" },
          _count: { _all: true },
          orderBy: { _count: { actionType: "desc" } },
        }),
        prisma.economyEntry.findMany({
          where: { gameId, source: "PLUG" },
          orderBy: { amount: "desc" },
          take: 50,
          select: { id: true, fromKind: true, fromName: true, toKind: true, toName: true, amount: true, form: true },
        }),
      ]);

      data = {
        ...data,
        reconciliation,
        unattributed: unattributed.map((u) => ({ actionType: u.actionType ?? "(none)", count: u._count._all })),
        plugRows,
      };
      break;
    }

    case "flows": {
      const raw = await searchParams;
      // A turn-range control as plain query params — no client state, so the
      // range survives a reload and a shared link reproduces exactly what a
      // GM was looking at. Defaults to the whole game.
      const bounds = await prisma.economyEntry.aggregate({
        where: { gameId },
        _min: { turnNumber: true },
        _max: { turnNumber: true },
      });
      const minTurn = bounds._min.turnNumber ?? 0;
      const maxTurn = bounds._max.turnNumber ?? 0;
      const fromTurn = raw?.from ? Number(raw.from) : null;
      const toTurn = raw?.to ? Number(raw.to) : null;

      const [flowRows, edges] = await Promise.all([
        flowsByTurn({ gameId, fromTurn, toTurn }),
        counterpartyEdges({ gameId, fromTurn, toTurn, limit: 40 }),
      ]);

      const sankey = sankeyFromFlows(flowRows);
      const arcWeb = arcWebFromEdges(edges);

      // The table under the sankey: one row per faucet/sink reason in this
      // range, so a GM can drill straight into the Ledger filtered to it.
      const byReason = new Map();
      for (const r of flowRows) {
        const flow = reasonFlow(r.reason);
        if (flow !== FLOW.FAUCET && flow !== FLOW.SINK) continue;
        const cur = byReason.get(r.reason) ?? { reason: r.reason, flow, amount: 0 };
        cur.amount += r.amount;
        byReason.set(r.reason, cur);
      }
      const reasonRows = [...byReason.values()]
        .map((r) => ({ ...r, label: reasonLabel(r.reason) }))
        .sort((a, b) => b.amount - a.amount);

      data = {
        ...data,
        sankey,
        arcWeb,
        reasonRows,
        minTurn,
        maxTurn,
        fromTurn: fromTurn ?? minTurn,
        toTurn: toTurn ?? maxTurn,
      };
      break;
    }

    case "faucets":
    case "sinks": {
      const wantFlow = section === "faucets" ? FLOW.FAUCET : FLOW.SINK;
      const flowRows = await flowsByTurn({ gameId });

      // Every reason this repo has ever declared for this flow, not just the
      // ones with rows — a faucet nobody has hit yet is still a row worth
      // showing at 0, the same reason UNATTRIBUTED gets its own bar on
      // purpose rather than being filtered away.
      const reasons = Object.entries(REASONS)
        .filter(([, v]) => v.flow === wantFlow)
        .map(([reason]) => reason);

      const byTurn = new Map();
      const totalByReason = new Map(reasons.map((r) => [r, 0]));
      for (const row of flowRows) {
        if (reasonFlow(row.reason) !== wantFlow) continue;
        const t = row.turnNumber ?? 0;
        if (!byTurn.has(t)) byTurn.set(t, {});
        const bucket = byTurn.get(t);
        bucket[row.reason] = (bucket[row.reason] ?? 0) + row.amount;
        totalByReason.set(row.reason, (totalByReason.get(row.reason) ?? 0) + row.amount);
      }
      const turns = [...byTurn.keys()].sort((a, b) => a - b);
      const categories = turns.map((t) => ({ x: t, values: byTurn.get(t) }));
      const series = reasons
        // Series with nothing in the whole range would still take a legend
        // slot and a stack colour for a band that never draws — drop them
        // from the chart series (the table below still lists every reason).
        .filter((r) => totalByReason.get(r) > 0)
        .map((r) => ({ key: r, label: reasonLabel(r) }));

      const grandTotal = [...totalByReason.values()].reduce((a, b) => a + b, 0);
      const table = reasons
        .map((r) => ({
          reason: r,
          label: reasonLabel(r),
          total: totalByReason.get(r) ?? 0,
          share: grandTotal > 0 ? (totalByReason.get(r) ?? 0) / grandTotal : 0,
          sparkline: turns.map((t) => byTurn.get(t)?.[r] ?? 0),
        }))
        .sort((a, b) => b.total - a.total);

      data = { ...data, series, categories, table, grandTotal };

      // Faucets only: designed vs. realised for labor drops. summarize() from
      // labordropsEv.js wants priced pool rows plus a roll-share table per
      // zone/location/holds combination (see db/scripts/ops/audit-labor-
      // drops.js) — that is a YAML-parse-and-simulate job, not something this
      // page render can assemble cheaply per request. So only the realised
      // side is shown; the designed side stays a `npm run
      // db:audit-labor-drops` job rather than a live number here.
      if (section === "faucets") {
        data.laborDropRealised = totalByReason.get("LABOR_DROP") ?? 0;
        data.laborDropNote =
          "Expected value per pool isn't wired into this page — it needs docs/labordrops.yaml priced and rolled per zone/location, which npm run db:audit-labor-drops already does. Only the realised total is shown here.";
      }
      break;
    }

    case "goods": {
      // Every priced tag against reality — no zone scoping, same as every
      // other aggregate on this page: a tag's world count and trade history
      // don't change depending on which zones a GM can see.
      const catalog = await goodsCatalog();
      data = { ...data, catalog };
      break;
    }

    case "depot": {
      const openTurn = await getOpenTurn();
      const [books, flowRows] = await Promise.all([depotBooks(), flowsByTurn({ gameId })]);

      // Balance of trade from the Depot's own side: an order pays obols IN,
      // a sale pays obols OUT. DivergingBars wants both magnitudes
      // non-negative, so order -> positive, sale -> negative.
      const byTurn = new Map();
      for (const r of flowRows) {
        if (r.reason !== "DEPOT_ORDER" && r.reason !== "DEPOT_SALE") continue;
        const t = r.turnNumber ?? 0;
        if (!byTurn.has(t)) byTurn.set(t, { turnNumber: t, order: 0, sale: 0 });
        const bucket = byTurn.get(t);
        if (r.reason === "DEPOT_ORDER") bucket.order += r.amount;
        else bucket.sale += r.amount;
      }
      const turns = [...byTurn.keys()].sort((a, b) => a - b);
      const tradePoints = turns.map((t) => {
        const b = byTurn.get(t);
        return { x: t, positive: b.order, negative: b.sale };
      });

      data = {
        ...data,
        books,
        // The train runs on turn parity and nothing else (db/lib/train.js).
        trainHere: trainHere(openTurn?.number ?? 0),
        tradePoints,
      };
      break;
    }

    case "factions": {
      const openTurn = await getOpenTurn();
      const treasuries = await factionTreasuries();
      const siloIds = treasuries.map((f) => f.siloRoomId).filter(Boolean);

      // Contributions in / draws out THIS TURN, for each faction's silo.
      // Only amounts are read here, never a counterparty name, so there is
      // nothing for redactEntry to withhold from a plain GM — a cult silo's
      // balance and this-turn totals are already the whole of what's shown.
      let flowById = new Map();
      if (openTurn && siloIds.length) {
        const legs = await prisma.$queryRaw`
          SELECT id, SUM(inflow)::int AS inflow, SUM(outflow)::int AS outflow FROM (
            SELECT "fromId" AS id, 0 AS inflow, SUM("amount")::int AS outflow
              FROM "EconomyEntry"
             WHERE "gameId" = ${gameId} AND "turnNumber" = ${openTurn.number} AND "form" = 'BALANCE'
               AND "fromKind" = 'room' AND "fromId" = ANY(${siloIds})
             GROUP BY 1
            UNION ALL
            SELECT "toId" AS id, SUM("amount")::int AS inflow, 0 AS outflow
              FROM "EconomyEntry"
             WHERE "gameId" = ${gameId} AND "turnNumber" = ${openTurn.number} AND "form" = 'BALANCE'
               AND "toKind" = 'room' AND "toId" = ANY(${siloIds})
             GROUP BY 1
          ) legs GROUP BY id`;
        flowById = new Map(legs.map((l) => [l.id, { in: Number(l.inflow) || 0, out: Number(l.outflow) || 0 }]));
      }

      const factions = treasuries.map((f) => {
        const flow = f.siloRoomId ? flowById.get(f.siloRoomId) ?? { in: 0, out: 0 } : null;
        return { ...f, turnIn: flow?.in ?? 0, turnOut: flow?.out ?? 0 };
      });

      data = { ...data, factions, openTurnNumber: openTurn?.number ?? null };
      break;
    }

    default:
      data = { ...data, notBuilt: true };
      break;
  }

  return <SnapshotFresh scope={`gm-economy:${section}`} userId={userId} data={data} />;
}
