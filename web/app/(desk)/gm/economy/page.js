import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@lifeweb/db";
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
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const rawSearch = await searchParams;
  const section = rawSearch?.s || "pulse";
  const openTurn = await getOpenTurn();

  return (
    <div className="desk-shell">
      <DeskHeader title="Economy" meta={<DeskTurnChip turn={openTurn} />} />
      <div className="desk-body desk-body--ops">
        <EconomyNav section={section} />
        <main className="ops-main">
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
        prisma.character.findMany({ where: { status: "ALIVE" }, select: { resources: true } }),
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

      const { gini: giniValue, lorenz } = gini(aliveResources.map((c) => c.resources));

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
      const zoneFilter = zoneWhere(visibleZoneNames);
      const [pageResult, reasonCounts] = await Promise.all([
        ledgerPage({ gameId, page, pageSize: 50, where, visibleZoneNames }),
        prisma.economyEntry.groupBy({
          by: ["reason"],
          where: { gameId, ...zoneFilter },
          _count: { _all: true },
          orderBy: { _count: { reason: "desc" } },
        }),
      ]);

      const entries = pageResult.rows.map((row) => {
        const r = redactEntry(row, { unredacted: unredacted });
        return {
          id: r.id,
          at: r.at,
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
        page: pageResult.page,
        pages: pageResult.pages,
        reasonFilter: reason,
        reasonCounts: reasonCounts.map((r) => ({ reason: r.reason, count: r._count._all })),
      };
      break;
    }

    case "accounts": {
      const openTurn = await getOpenTurn();
      const [chars, rooms, legs] = await Promise.all([
        prisma.character.findMany({
          where: { status: { in: ["ALIVE", "DEAD"] } },
          select: {
            id: true,
            name: true,
            status: true,
            resources: true,
            faction: { select: { zone: { select: { name: true } } } },
            zone: { select: { name: true } },
          },
        }),
        prisma.room.findMany({
          select: {
            id: true,
            name: true,
            resources: true,
            location: { select: { zone: { select: { name: true } } } },
          },
        }),
        openTurn
          ? prisma.$queryRaw`
              SELECT kind, id, SUM(inflow)::int AS inflow, SUM(outflow)::int AS outflow FROM (
                SELECT "fromKind" AS kind, "fromId" AS id, 0 AS inflow, SUM("amount")::int AS outflow
                  FROM "EconomyEntry"
                 WHERE "gameId" = ${gameId} AND "turnNumber" = ${openTurn.number} AND "fromKind" IN ('character','room')
                 GROUP BY 1, 2
                UNION ALL
                SELECT "toKind" AS kind, "toId" AS id, SUM("amount")::int AS inflow, 0 AS outflow
                  FROM "EconomyEntry"
                 WHERE "gameId" = ${gameId} AND "turnNumber" = ${openTurn.number} AND "toKind" IN ('character','room')
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
            balance: c.resources,
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
            balance: r.resources,
            inflow: flow.inflow,
            outflow: flow.outflow,
          };
        }),
      ];

      const scoped = inVisibleZones(rows, visibleZoneNames);

      data = { ...data, rows: scoped, openTurnNumber: openTurn?.number ?? null };
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

    default:
      data = { ...data, notBuilt: true };
      break;
  }

  return <SnapshotFresh scope={`gm-economy:${section}`} userId={userId} data={data} />;
}
