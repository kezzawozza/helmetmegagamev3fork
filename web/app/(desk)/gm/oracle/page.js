// The Oracle desk. See ORACLE.md. The (desk) layout has already checked isGm
// (web/app/(desk)/layout.js), so there's no gate here — the one server
// action re-checks for itself regardless; a layout gate is presentation.

import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import { GmZoneViewProvider } from "@/app/components/GmZoneViewProvider";
import OracleDesk from "./OracleDesk";

const FRONT_PAGE = "__front__";
const THREATS_PAGE = "__threats__";

export default async function OraclePage({ searchParams }) {
  const params = await searchParams;

  // Hoisted out of the playtest branch below so it runs either way — the
  // Regenerate button needs to know whether THIS reader is a superadmin
  // regardless of whether playtest is on.
  const { session } = await getGmSession();
  const canRegenerate = isSuperadmin(session?.discordUserId);

  // The playtest switch, ENFORCED here, not merely hidden from the rail —
  // same posture as /chat's playPanelEnabled. Superadmin, not GM: the point is reviewing the Oracle first.
  const config = await prisma.gameConfig.findFirst({ select: { oraclePlaytest: true } });
  if (config?.oraclePlaytest && !canRegenerate) {
    redirect("/gm/players");
  }

  // Newest first, and the OPEN turn is offered like any other — its page is
  // what a gamemaster reads while adjudicating, in the hours before the push.
  const turns = await prisma.turn.findMany({
    orderBy: { number: "desc" },
    take: 60,
    select: {
      id: true,
      number: true,
      dayNumber: true,
      _count: { select: { oraclePages: true } },
    },
  });

  if (turns.length === 0) {
    return (
      <div className="desk-shell">
        {/* No DeskHeader any more — its only content was the lock/clock
            chips, redundant with the universal top bar's own clock block. */}
        <div className="desk-body">
          <div className="desk-empty">
            <p>No turn has begun yet.</p>
          </div>
        </div>
      </div>
    );
  }

  // Default to the newest turn actually written, not simply the newest —
  // otherwise the open turn's blank page hides yesterday's chronicle for hours.
  const wanted = Number.parseInt(params?.turn, 10);
  const turn =
    turns.find((t) => t.number === wanted) ?? turns.find((t) => t._count.oraclePages > 0) ?? turns[0];

  const [rows, zones, characters, visibleZones, selectableZones] = await Promise.all([
    prisma.oracleSynopsis.findMany({
      where: { turnId: turn.id },
      select: {
        id: true,
        body: true,
        threads: true,
        editedAt: true,
        model: true,
        kind: true,
        zone: { select: { id: true, slug: true, name: true } },
      },
    }),
    prisma.zone.findMany({
      where: { gmRoleId: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true },
    }),
    // The inspector resolves a clicked {char:<id>} against this, also what
    // the rail counts. ALIVE only — a dead character's old mention renders as plain text, fail-closed.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        discordUserId: true,
        zoneId: true,
        role: { select: { name: true } },
        // seatZoneId too — lands a cave-LEVEL character on the cave GROUP's row (db/lib/seatZone.js), else the badge never counts them.
        zone: { select: { name: true, seatZoneId: true } },
      },
    }),
    getVisibleZones(),
    listSelectableZones(),
  ]);

  // `!row.zone` also matches the Threats row (no real Zone either, ORACLE.md), so `kind` tells the two apart.
  const front = rows.find((row) => row.kind === "FRONT") ?? null;

  // A zone-shaped title for a row with no Zone relation — the Threats row.
  function titleFor(row) {
    return row.zone?.name ?? (row.kind === "THREATS" ? "Threats" : `Turn ${turn.number}`);
  }

  // Deterministic, front page first, Threats sorted in with named zones
  // (ORACLE.md) — `pages[0]` below must be reproducible even with no `orderBy` on the query above.
  const orderedRows = [...rows].sort((a, b) => {
    if (a.kind === "FRONT") return -1;
    if (b.kind === "FRONT") return 1;
    return titleFor(a).localeCompare(titleFor(b));
  });

  const pages = orderedRows.map((row) => ({
    key: row.zone?.slug ?? (row.kind === "THREATS" ? THREATS_PAGE : FRONT_PAGE),
    id: row.id,
    title: titleFor(row),
    body: row.body,
    model: row.model,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
  }));

  // Threads live on the front page only. A malformed/absent array reads as no threads, not a crash.
  const threads = Array.isArray(front?.threads)
    ? front.threads.filter((t) => t && typeof t.name === "string" && typeof t.state === "string").slice(0, 5)
    : [];

  const counts = {};
  for (const zone of zones) counts[zone.id] = { present: 0 };
  for (const character of characters) {
    const seatId = character.zone?.seatZoneId ?? character.zoneId;
    if (counts[seatId]) counts[seatId].present += 1;
  }

  const requested = typeof params?.page === "string" ? params.page : null;
  // A REAL target — the front page, or a seat zone with nothing written this
  // turn — is kept as-is, never swapped for someone else's page. A
  // page-less target still resolves to `null` through OracleDesk.js's
  // `pageFor()`, which draws the empty state; this only decides which rail button it highlights.
  const isRealTarget =
    requested === FRONT_PAGE || requested === THREATS_PAGE || zones.some((z) => z.slug === requested);
  const selectedKey = isRealTarget
    ? requested
    : front
      ? FRONT_PAGE
      : (pages[0]?.key ?? FRONT_PAGE);

  const roster = characters.map((character) => ({
    id: character.id,
    name: character.name,
    discordUserId: character.discordUserId,
    roleTitle: character.role?.name ?? null,
    zoneName: character.zone?.name ?? null,
  }));

  return (
    <GmZoneViewProvider initialZoneNames={visibleZones?.map((zone) => zone.name) ?? null}>
      <OracleDesk
        turn={{ number: turn.number, dayNumber: turn.dayNumber }}
        turns={turns.map((t) => ({ number: t.number, dayNumber: t.dayNumber }))}
        pages={pages}
        threads={threads}
        zones={zones}
        counts={counts}
        roster={roster}
        selectableZones={selectableZones}
        visibleZoneIds={visibleZones?.map((zone) => zone.id) ?? null}
        visibleZoneNames={visibleZones?.map((zone) => zone.name) ?? null}
        selectedKey={selectedKey}
        canRegenerate={canRegenerate}
      />
    </GmZoneViewProvider>
  );
}
