// SERVER ONLY — imports the Prisma barrel through moveRows.js. The desk reads rows from the page and a
// server action; moveRows.js keeps the two from drifting on row SHAPE, this file on CONTEXT.
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { placementOf } from "@lifeweb/db/lib/structures";
import { listGuildMembers } from "./discordGuild";
import { pgNowMs } from "./pgClock";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  moveRow,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
} from "./moveRows";

// Every structure standing at a set of Locations, in ONE pair of queries (mirrors db/lib/structures.js#structuresAt).
export async function structuresByLocation(locationIds) {
  const ids = [...new Set((locationIds ?? []).filter(Boolean))];
  const byLocationId = new Map();
  if (!ids.length) return byLocationId;

  const rows = await prisma.structure.findMany({
    where: { locationId: { in: ids } },
    // id tiebreaker keeps two same-instant rows in one stable order, matching structuresAt.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const slugs = [...new Set(rows.map((s) => s.typeSlug))];
  const types = slugs.length
    ? await prisma.tag.findMany({ where: { slug: { in: slugs } }, select: { slug: true, placement: true } })
    : [];
  const typeBySlug = new Map(types.map((t) => [t.slug, t]));
  for (const row of rows) {
    const type = typeBySlug.get(row.typeSlug) ?? null;
    const list = byLocationId.get(row.locationId) ?? [];
    list.push({ ...row, placement: type ? placementOf(type) : null });
    byLocationId.set(row.locationId, list);
  }
  return byLocationId;
}

// `openTurn` is passed by a caller that already has it; pass `null` for "genuinely no open turn". NO CLOCK HERE (see deskPatchFor).
export async function deskRowContext({ openTurn } = {}) {
  const [members, catatonicTagRows, locations, fetchedTurn] = await Promise.all([
    listGuildMembers(),
    // Who is AFK right now, for the queue rows' avatar badge.
    prisma.characterTag.findMany({
      where: { tag: { slug: CATATONIC_SLUG }, character: { status: "ALIVE" } },
      select: { characterId: true },
    }),
    // The staged "Relocate to" picker's options, grouped by zone (docs/zones.yaml order).
    prisma.location.findMany({
      orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
    }),
    openTurn === undefined
      ? prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } })
      : null,
  ]);

  const locationRows = locations.map((l) => ({
    id: l.id,
    name: l.name,
    zoneId: l.zoneId,
    zoneName: l.zone?.name ?? null,
  }));

  return {
    usernameById: new Map(members.map((m) => [m.id, m.username])),
    catatonicIds: new Set(catatonicTagRows.map((row) => row.characterId)),
    locationRows,
    locationNameById: new Map(locationRows.map((l) => [l.id, l.name])),
    openTurn: openTurn === undefined ? fetchedTurn : openTurn,
    now: new Date(),
  };
}

// The patch a mutation hands back: rows it touched, re-read through the same DTO mappers the page uses.
// An id asked for and not returned is REMOVED, not missing. `onDeskOnly` is the LIVE CHANNEL's flag,
// since the stream (unlike a mutation) gets whatever ids Postgres announced, including last turn's.
export async function deskPatchFor({
  moveIds = [],
  cavingRollIds = [],
  stagedEffectIds = [],
  stagedMessageIds = [],
  removed = {},
  onDeskOnly = false,
} = {}) {
  const ctx = await deskRowContext();

  const [actions, rolls, effects, messages] = await Promise.all([
    moveIds.length
      ? prisma.action.findMany({ where: { id: { in: moveIds } }, include: MOVE_INCLUDE })
      : [],
    cavingRollIds.length
      ? prisma.cavingRoll.findMany({ where: { id: { in: cavingRollIds } }, include: CAVING_ROLL_INCLUDE })
      : [],
    stagedEffectIds.length
      ? prisma.stagedEffect.findMany({ where: { id: { in: stagedEffectIds } }, include: STAGED_EFFECT_INCLUDE })
      : [],
    stagedMessageIds.length
      ? prisma.stagedMessage.findMany({ where: { id: { in: stagedMessageIds } }, include: STAGED_MESSAGE_INCLUDE })
      : [],
  ]);

  // Off the desk is not the same as gone: a dropped id is reported as neither a row nor a removal.
  const openTurnId = ctx.openTurn?.id ?? null;
  const onDesk = (rows, predicate) => (onDeskOnly ? rows.filter(predicate) : rows);
  const ofOpenTurn = (r) => openTurnId != null && r.turnId === openTurnId;
  const liveActions = onDesk(actions, ofOpenTurn);
  const liveRolls = onDesk(rolls, ofOpenTurn);
  const liveEffects = onDesk(effects, (e) => ofOpenTurn(e) || e.appliedAt == null);
  const liveMessages = onDesk(messages, (m) => ofOpenTurn(m) || m.sentAt == null);

  const structuresByLocationId = await structuresByLocation(
    liveActions.map((a) => a.character.locationId),
  );

  // THE CLOCK IS READ LAST, load-bearing: read after every query resolves, so `asOfMs` can only under-claim freshness (deskStore.js).
  const asOfMs = await pgNowMs();

  // Only an id that came back and was dropped as off-desk is excused; one that never came back is genuinely gone.
  const gone = (asked, found) => {
    const here = new Set(found.map((r) => r.id));
    return asked.filter((id) => !here.has(id));
  };

  return {
    asOfMs,
    // Which turn this patch was showing; applyDeskPatch drops a mismatched patch.
    turnId: openTurnId,
    moves: liveActions.map((a) => moveRow(a, { ...ctx, structuresByLocationId })),
    cavingRolls: liveRolls.map((c) => cavingRollRow(c, ctx)),
    stagedEffects: liveEffects.map((e) => stagedEffectRow(e, ctx)),
    stagedMessages: liveMessages.map((m) => stagedMessageRow(m, ctx)),
    removed: {
      moveIds: [...(removed.moveIds ?? []), ...gone(moveIds, actions)],
      cavingRollIds: [...(removed.cavingRollIds ?? []), ...gone(cavingRollIds, rolls)],
      stagedEffectIds: [...(removed.stagedEffectIds ?? []), ...gone(stagedEffectIds, effects)],
      stagedMessageIds: [...(removed.stagedMessageIds ?? []), ...gone(stagedMessageIds, messages)],
    },
  };
}
