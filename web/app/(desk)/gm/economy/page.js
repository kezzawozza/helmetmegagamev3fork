import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@lifeweb/db";
import { visibleZoneIds as loadVisibleZoneIds } from "@lifeweb/db/lib/gmZoneView";
import { reasonLabel } from "@lifeweb/db/lib/economyReasons";
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

    default:
      data = { ...data, notBuilt: true };
      break;
  }

  return <SnapshotFresh scope={`gm-economy:${section}`} userId={userId} data={data} />;
}
