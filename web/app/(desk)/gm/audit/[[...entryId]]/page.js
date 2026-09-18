import { redirect } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import AuditView from "./AuditView";
import Loading from "../Skeleton";
import { prisma } from "@lifeweb/db";
import { chipSelect, composeChipTag, GM_CHIP_CTX } from "@/lib/referenceData";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { getOpenTurn } from "@/lib/turn";
import { sortZones } from "@/lib/zones";
import { getVisibleZones, listSelectableZones } from "@/lib/gmZoneView";
import {
  PAGE_SIZE,
  buildAuditWhere,
  loadAuditContext,
  parseAuditParams,
  turnAt,
} from "@/lib/auditQuery";

// The audit desk's server half: one load, all DTOs, no Prisma-shaped object
// across the client boundary — the same rule the adjudication desk states.
//
// Open to every GM. It used to be superadmin-only on the argument that with
// five GMs the log is a record OF them rather than a tool FOR them; in
// practice that left four people unable to answer "who changed this", which is
// the question the log exists for. Peer visibility is the point now, and the
// Actor filter's GMs-only toggle makes reviewing each other a first-class
// view rather than a thing you squint for.
//
// The (desk) layout already redirects a non-GM; the check below is the same
// belt as every other page in the group, and the export action re-checks for
// real.

// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshAudit in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function AuditPage({ params, searchParams }) {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  const routeParams = await params;
  const selectedId = routeParams?.entryId?.[0] ?? null;
  return (
    <SnapshotPage scope={`gm-audit:${selectedId ?? ""}`} userId={session.discordUserId} render={AuditView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshAudit params={params} searchParams={searchParams} userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshAudit({ params, searchParams, userId }) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!isGm) redirect("/character");

  const [routeParams, rawSearch] = await Promise.all([params, searchParams]);
  const selectedId = routeParams?.entryId?.[0] ?? null;
  const filters = parseAuditParams(rawSearch);

  const [guildMembers, gmProfiles, openTurn, zones, locations, visibleZones, selectableZones] = await Promise.all([
    listGuildMembers(),
    getGmProfiles(),
    getOpenTurn(),
    // Seat zones: every stamped zoneId in the app is one, so the three cave
    // levels would be four filter options nothing ever matches.
    prisma.zone.findMany({ where: { kind: { not: "CAVE_LEVEL" } }, select: { id: true, name: true } }),
    // WHERE it happened — a different axis from the Zone filter above, which
    // is where the target is standing. Rooms travel nested under their
    // Location so the filter can narrow the room list to the chosen place.
    prisma.location.findMany({
      select: { id: true, name: true, rooms: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    // The zone picker at the foot of the inspector. The audit log itself is
    // not filtered by it — a GM reading the log is answering "who did this",
    // and hiding rows would answer it wrongly — but the control belongs
    // wherever a GM sits, because it is also what grants their "GM: <Zone>"
    // Discord roles.
    getVisibleZones(),
    listSelectableZones(),
  ]);

  const gmIds = gmProfiles.map((p) => p.discordUserId);
  const ctx = await loadAuditContext({ gmIds, guildMembers });

  const where = await buildAuditWhere(filters, ctx);

  const [rows, total, typeCounts] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        targetCharacter: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    // Counts beside each entry in the type picker, over the CURRENT filter
    // minus the type filter itself — so picking one type does not collapse
    // every other count to zero and strand the GM there.
    prisma.auditLog.groupBy({
      by: ["actionType"],
      _count: { _all: true },
      where: await buildAuditWhere({ ...filters, types: [] }, ctx),
      orderBy: { _count: { actionType: "desc" } },
      take: 200,
    }),
  ]);

  // A permalink may name a row that is not on this page — a different filter,
  // or forty pages back. Fetch it alongside rather than making the reader hunt.
  const pinned =
    selectedId && !rows.some((r) => r.id === selectedId)
      ? await prisma.auditLog.findUnique({
          where: { id: selectedId },
          include: {
            targetCharacter: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
          },
        })
      : null;

  // id -> name for everything a `details` blob can point at, so a sentence can
  // say "Black Hills" where the payload says a cuid. Tags are the only list here
  // with real size, and it is a few hundred rows of two columns.
  //
  // Wider than that alone for AuditSegments' hover. Two things this query has
  // to get right, both learned the hard way:
  //
  // chipSelect() + composeChipTag, not a hand-picked column list. The old one
  // took `description` and no paper columns, so every player-written note
  // hovered BLANK — a paper keeps its words in `paperText` and its description
  // column is null (web/lib/tagChipRows.js).
  //
  // And it is no longer the whole table. Runtime-minted rows are unbounded game
  // state, so composing all of them with a GM context would put the full text
  // of every letter in the game into this page's payload on every load. Same
  // shape getVisibleTags uses for the same problem: the bounded catalog, plus
  // only the runtime rows the entries on THIS page actually name. Paging is a
  // full server re-render, so the set is recomputed per page.
  const referencedTagIds = new Set();
  // A revoke written before the row carried the claim text: read it off the Desire instead.
  const revokedDesireIds = new Set();
  // `pinned` is fetched apart from the page (it is whatever entry the GM has
  // open, which need not be on this page), so it has to be scanned too or its
  // own chip is the one thing on screen that will not resolve.
  for (const row of [...rows, ...(pinned ? [pinned] : [])]) {
    const d = row.details && typeof row.details === "object" ? row.details : null;
    if (!d) continue;
    if (d.tagId) referencedTagIds.add(String(d.tagId));
    if (row.actionType === "gm_desire_cancelled" && d.desireId && d.claimText === undefined) {
      revokedDesireIds.add(String(d.desireId));
    }
    // applyTagOpsInTx's `applied` array — a GM's staged ops carry their own.
    for (const op of Array.isArray(d.tags) ? d.tags : []) {
      if (op?.tagId) referencedTagIds.add(String(op.tagId));
    }
  }
  const tags = (
    await prisma.tag.findMany({
      where: { OR: [{ ephemeral: false }, { id: { in: [...referencedTagIds] } }] },
      select: chipSelect(),
    })
  ).map((t) => composeChipTag(t, GM_CHIP_CTX));
  const revokedDesires = new Map(
    (revokedDesireIds.size
      ? await prisma.desire.findMany({
          where: { id: { in: [...revokedDesireIds] } },
          select: { id: true, text: true, reason: true },
        })
      : []
    ).map((r) => [r.id, r]),
  );
  const names = Object.fromEntries([
    ...tags.map((t) => [t.id, t.name]),
    ...zones.map((z) => [z.id, z.name]),
    ...ctx.characters.map((c) => [c.id, c.name]),
  ]);

  const usernameById = new Map(
    guildMembers.map((m) => [m.id, m.globalName ?? m.username ?? m.id]),
  );
  const gmProfileById = new Map(gmProfiles.map((p) => [p.discordUserId, p]));
  const gmIdSet = new Set(gmIds);
  // A player's live character, so a row's actor reads as a person rather than
  // a snowflake. ALIVE wins when someone has re-rolled.
  const characterByUser = new Map();
  for (const c of ctx.characters) {
    const existing = characterByUser.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterByUser.set(c.discordUserId, c);
  }

  function toDto(row) {
    const turn = turnAt(ctx.turns, row.createdAt);
    const character = characterByUser.get(row.actorDiscordUserId) ?? null;
    const isSystem = row.actorDiscordUserId === "system";
    return {
      id: row.id,
      actionType: row.actionType,
      createdAt: row.createdAt.toISOString(),
      reason: row.reason ?? null,
      details: withRevokedDesire(row, revokedDesires),
      actor: {
        discordUserId: row.actorDiscordUserId,
        name: isSystem ? "The turn engine" : usernameById.get(row.actorDiscordUserId) ?? row.actorDiscordUserId,
        avatarUrl: gmProfileById.get(row.actorDiscordUserId)?.avatarUrl ?? null,
        kind: isSystem ? "system" : gmIdSet.has(row.actorDiscordUserId) ? "gm" : "player",
        characterId: character?.id ?? null,
        characterName: character?.name ?? null,
      },
      target: row.targetCharacter ? { id: row.targetCharacter.id, name: row.targetCharacter.name } : null,
      location: row.location ? { id: row.location.id, name: row.location.name } : null,
      room: row.room ? { id: row.room.id, name: row.room.name } : null,
      turnNumber: turn?.number ?? null,
      dayNumber: turn?.dayNumber ?? null,
    };
  }

  const entries = rows.map(toDto);

  // Actor options: everyone who has ever been an actor is not a list we hold,
  // so this is the guild's GMs plus everyone with a character — the same union
  // the player desk's rail builds, and the same people who write rows.
  const actorOptions = [
    ...gmProfiles.map((p) => ({
      id: p.discordUserId,
      name: usernameById.get(p.discordUserId) ?? p.discordUserId,
      kind: "gm",
      avatarUrl: p.avatarUrl ?? null,
    })),
    ...ctx.characters
      .filter((c) => c.discordUserId && !gmIdSet.has(c.discordUserId))
      .map((c) => ({ id: c.discordUserId, name: c.name, kind: "player", avatarUrl: null })),
  ];
  // One row per Discord ID; a player with two characters is still one actor.
  const actorById = new Map(actorOptions.map((a) => [a.id, a]));

  return (
    <SnapshotFresh
      scope={`gm-audit:${selectedId ?? ""}`}
      userId={userId}
      data={{
        entries: entries,
        // One shared id -> name map rather than a copy per row: at 60 rows and a
        // few hundred tags, hanging it off each DTO would be most of the payload.
        names: names,
        // The catalog plus the runtime rows these entries name, composed —
        // AuditDesk.js keys them BOTH ways and only lets a paper be found by
        // id. See the query comment above.
        tags: tags,
        pinned: pinned ? toDto(pinned) : null,
        selectedId: selectedId,
        total: total,
        pageSize: PAGE_SIZE,
        filters: serializeFilters(filters),
        openTurn: openTurn ? { number: openTurn.number, dayNumber: openTurn.dayNumber } : null,
        typeCounts: typeCounts.map((t) => ({ actionType: t.actionType, count: t._count._all })),
        actors: [...actorById.values()].sort((a, b) => a.name.localeCompare(b.name)),
        characters: ctx.characters
        .map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
        zones: sortZones(zones),
        // WHERE it happened — the room filter's options, nested under
        // Location so the rail can narrow rooms to whichever place is picked.
        locations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          rooms: l.rooms.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)),
        })),
        turnNumbers: ctx.turns.map((t) => t.number),
        selectableZones: selectableZones,
        visibleZoneIds: visibleZones?.map((zone) => zone.id) ?? [],
      }}
    />
  );
}

// Dates cannot cross to a client component as Date objects without becoming
// something the filter controls cannot echo back, so they travel as the same
// YYYY-MM-DD strings the inputs use.
// A gm_desire_cancelled row from before the audit kept the claim: borrow the Desire's own name and reason.
// Rows that already carry claimText, and every other action type, come back untouched.
function withRevokedDesire(row, revokedDesires) {
  const d = row.details ?? null;
  const desire = row.actionType === "gm_desire_cancelled" && d?.claimText === undefined
    ? revokedDesires.get(String(d?.desireId))
    : null;
  if (!desire) return d;
  return { ...d, desireName: d.desireName ?? desire.text, claimText: desire.reason };
}

function serializeFilters(filters) {
  return {
    ...filters,
    from: filters.from ? filters.from.toISOString().slice(0, 10) : "",
    to: filters.to ? filters.to.toISOString().slice(0, 10) : "",
  };
}
