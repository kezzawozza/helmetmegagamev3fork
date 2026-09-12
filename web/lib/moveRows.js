// SERVER ONLY. This module imports the Prisma barrel (through
// referenceData.js), so importing it from a "use client" file bundles every
// server-only module into the browser, and the first Node-only module (fs)
// throws at load. Pure helpers a client component needs go in their own
// import-free file (see stagingReach.js).
import { CATATONIC_SLUG } from "@lifeweb/db/lib/constants";
import { statusWord, WORKING_STATUSES } from "@lifeweb/db/lib/structures";
import { MOVE_PIPELINE_LABELS, MOVE_REVIEW_LABELS, moveKindLabel, isTravelMove, rollLabel } from "@/lib/moves";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";
import { CAVING_KIND_LABELS } from "@/lib/cavingLabels";

// The DTO mappers the adjudication desk's queue is built from, in one
// place so the two callers (an RSC and a server action) can't drift.

// The includes each mapper expects, exported for the same reason: a query
// missing one produces a DTO with silently empty fields rather than an error.
export const MOVE_INCLUDE = {
  character: {
    include: {
      // faction.zone is the ZONE SEAT this row answers to — a faction always
      // banks on a seat zone, never on a cave level; `zone` is the PRESENCE
      // zone, where they physically stand, which is what the desk labels.
      faction: { include: { zone: true } },
      zone: true,
      // The presence zone's name alone used to be all a Move could show —
      // Character.locationId is the authoritative "where they stand" since
      // Bascinet 2 (MAP.md §1), so the desk needs the Location's name too.
      location: { select: { id: true, name: true } },
      tags: {
        select: {
          tagId: true,
          quantity: true,
          expiresTurn: true,
          tag: { select: TAG_CHIP_FIELDS },
        },
      },
    },
  },
};

export const STAGED_EFFECT_INCLUDE = {
  targetCharacter: { select: { id: true, name: true, updatedAt: true } },
  turn: { select: { id: true, number: true } },
};

export const STAGED_MESSAGE_INCLUDE = {
  recipients: { include: { character: { select: { id: true, name: true, updatedAt: true } } } },
  // `kind` so the tray can say where a declaration actually goes: a cave
  // level has no #summary and fans out to its Location channels instead.
  zone: { select: { id: true, name: true, kind: true } },
  turn: { select: { id: true, number: true } },
  // One row per send (db/lib/stagedDelivery.js). The tray used to be able to
  // say only "Sent, some failed" off a JSON blob; with these it can say which
  // recipient, and whether the retry is still running.
  deliveries: true,
};

// The Caving lens' row shape. Same "one mapper, both callers" rule as the Move
// rows above: page.js builds the open turn's rows and getMoveHistory builds a
// past turn's, so cavingRollRow has to be the single source. lootTag and
// lootUndoneAt are what let a FIND offer Undo (see CAVING.md §4).
export const CAVING_ROLL_INCLUDE = {
  character: {
    select: {
      id: true,
      name: true,
      discordUserId: true,
      updatedAt: true,
      roleTitle: true,
      faction: { include: { zone: true } },
    },
  },
  zone: { select: { name: true } },
  // Where they walked in. The Die rolls once per LOCATION now, so one
  // character can hold several rolls in a turn and the zone alone no longer
  // tells them apart — which matters most for the TROUBLE row a GM has to
  // narrate, since "somewhere in the Caves" is not a place to set a scene in.
  location: { select: { name: true } },
  lootTag: { select: { name: true } },
};

function isConfirmed(a) {
  return a.status === "CONFIRMED" || a.status === "ADJUDICATED";
}

// The label is always the review-status label — a live lock never masks it.
// A lock renders separately, as presence (a GmAvatar chip — see
// QueueRail.js), never folded into the status a Save/Solve check reads.
export function moveStatusLabel(a, now) {
  if (!isConfirmed(a)) return MOVE_PIPELINE_LABELS[a.status] ?? a.status;
  return MOVE_REVIEW_LABELS[a.moveReviewStatus] ?? "Open";
}

// "+3 ⬢" / "rolled 5–12 ⬢ → +8". Takes anything carrying the two columns, so
// a raw Action row works as well as a mapped one.
//
// "0-0" is the machine expression for a Labor that was never going to pay ⬢ —
// a shift on the Factory floor, or a day worked with no skill that reaches
// this ground (db/lib/laborAccess.js). Printing "rolled 0–0 ⬢" for those said
// nothing twice, so they fall through to null and the desks render their own
// em dash.
export function declaredLabel(a) {
  // A 0-0 Labor rolls a real 0, so the payout it carries is 0 ⬢ — the range
  // and the value have to drop together or "→ 0 ⬢" is left standing alone.
  const unpaid = a.resourceRollExpression === "0-0";
  const parts = [];
  if (a.resourceRollExpression && !unpaid)
    parts.push(`rolled ${a.resourceRollExpression.replace("-", "–")} ⬢`);
  if (a.resourceDelta != null && !(unpaid && a.resourceDelta === 0))
    parts.push(`${a.resourceDelta > 0 ? "+" : ""}${a.resourceDelta} ⬢`);
  return parts.length ? parts.join(" → ") : null;
}

// What actually paid at the push — the appliedEffects snapshot as one line.
// Same form as db/lib/moveEffects.js#describeMoveEffects, written out here so
// the web side doesn't pull a db/lib module in just to print "+5 ⬢".
export function paidLabel(applied) {
  const parts = [];
  for (const [key, value] of Object.entries(applied ?? {})) {
    if (!value) continue;
    if (key === "resources") parts.push(`${value > 0 ? "+" : ""}${value} ⬢`);
    // Legacy rows recorded a bare `1`, always meaning a plain Exhausted grant.
    else if (key === "exhausted") parts.push(value?.slug === "tired" ? "Tired" : "Exhausted");
    // Mirrors the laborDrop arm of describeMoveEffects. Without it the desk
    // printed "laborDrop: [object Object]" — the cost of the deliberate
    // duplication at the top of this function is that both halves have to
    // learn a new effect key.
    else if (key === "laborDrop") {
      parts.push(
        value.kind === "TAG"
          ? `found ${value.tagName}`
          : `${value.amount > 0 ? "+" : ""}${value.amount} ⬢ (find)`,
      );
    }
    else parts.push(`${key}: ${value}`);
  }
  return parts.join(", ");
}

// "Palisade — standing: A ring of sharpened stakes…" — one line per
// structure at a Location, in creation order. The defenseNote prints ONLY
// while the structure actually works (WORKING_STATUSES — COMPLETE or
// DAMAGED): a ruined Battering Ram must not hand the desk a siege licence its
// wreck no longer grants. The status word still prints for every row, so the
// ruin stays visible as scenery. Imported, not mirrored: this module is
// server-only (it already imports the db barrel), so there is no reason
// for a second copy of the list that gates the licence.
const NOTE_STATUSES = new Set(WORKING_STATUSES);

function standingHereLines(structures) {
  if (!structures?.length) return [];
  return structures.map((s) => {
    const note = NOTE_STATUSES.has(s.status) ? s.placement?.defenseNote : null;
    return `${s.typeName} — ${statusWord(s.status)}${note ? `: ${note}` : ""}`;
  });
}

// ctx: { usernameById, now, structuresByLocationId }
export function moveRow(a, { usernameById, now, structuresByLocationId }) {
  const username = usernameById.get(a.character.discordUserId) ?? a.character.discordUserId;
  return {
    id: a.id,
    characterId: a.characterId,
    characterName: a.character.name,
    avatarVersion: a.character.updatedAt.getTime(),
    // AFK marker for the queue row's avatar badge — read straight off the
    // tags MOVE_INCLUDE already loads, so the History lens gets it too.
    catatonic: a.character.tags.some((ct) => ct.tag?.slug === CATATONIC_SLUG),
    // The player desk keys on discordUserId, not characterId — carried here
    // so a Move can link straight to that player's conversation.
    discordUserId: a.character.discordUserId,
    discordUsername: username,
    roleTitle: a.character.roleTitle ?? "",
    factionName: a.character.faction?.name ?? "",
    factionId: a.character.factionId ?? null,
    factionZoneName: a.character.faction?.zone?.name ?? "",
    description: a.description,
    kindLabel: moveKindLabel(a.moveKind, a.gmNotes),
    moveKind: a.moveKind ?? "ROUTINE",
    isTravel: isTravelMove(a.gmNotes),
    gmNotes: a.gmNotes ?? "",
    rollLabel: rollLabel(a),
    statusLabel: moveStatusLabel(a, now),
    // The enum itself, alongside the display label — clients branch on this,
    // not on the string, so a locale/wording change to the label can never
    // silently break a `solved` check (MoveDesk.js).
    reviewStatus: a.moveReviewStatus,
    // Where they stand. Key name kept because MoveDesk and InspectorColumn
    // still read `locationLabel`. Character.locationId is the authoritative
    // place since Bascinet 2 (MAP.md §1), so this is "Zone · Location" when
    // they're placed, falling back to the presence zone alone for the rare
    // character with no Location yet.
    locationLabel: a.character.location
      ? `${a.character.zone?.name ?? "?"} · ${a.character.location.name}`
      : a.character.zone?.name || "Unassigned",
    // The bare zoneId alongside the label above — PublicComposer needs the
    // id to preselect the Move's own zone, not just its name.
    zoneId: a.character.zone?.id ?? null,
    // "Fine House — half-built" per structure standing at the filer's
    // Location, for the Move card's "Standing here" line. Bulk-loaded by the
    // caller (one query for every Move on the desk, not one per row) and
    // handed in keyed by locationId; empty when there's nothing built there.
    standingHere: standingHereLines(structuresByLocationId?.get(a.character.locationId ?? "")),
    resources: a.character.resources,
    tags: a.character.tags.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      expiresTurn: ct.expiresTurn,
    })),
    resourceDelta: a.resourceDelta ?? null,
    resourceRollExpression: a.resourceRollExpression ?? null,
    declaredLabel: declaredLabel(a),
    paidLabel: paidLabel(a.appliedEffects),
    resultMessage: a.resultMessage ?? "",
    reviewedByUsername: a.reviewedByDiscordUserId
      ? (usernameById.get(a.reviewedByDiscordUserId) ?? a.reviewedByDiscordUserId)
      : null,
    reviewedByDiscordUserId: a.reviewedByDiscordUserId ?? null,
    reviewedAtLabel: a.reviewedAt ? a.reviewedAt.toISOString().slice(0, 16).replace("T", " ") : null,
    lockedByDiscordUserId: a.lockExpiresAt && a.lockExpiresAt > now ? (a.lockedByDiscordUserId ?? null) : null,
    createdAtMs: a.createdAt.getTime(),
  };
}

// ctx: { usernameById, locationNameById, openTurn }
export function stagedEffectRow(e, { usernameById, locationNameById, openTurn }) {
  return {
    id: e.id,
    moveId: e.moveId,
    cavingRollId: e.cavingRollId,
    batchId: e.batchId,
    // Nullable: an old, pre-Silo-removal faction-to-faction transfer has no
    // character end.
    targetCharacterId: e.targetCharacterId,
    targetName: e.targetCharacterId ? (e.targetCharacter?.name ?? "(deleted)") : null,
    targetAvatarVersion: e.targetCharacter?.updatedAt ? e.targetCharacter.updatedAt.getTime() : null,
    resources: e.payload?.resources ?? 0,
    tagPoints: e.payload?.tagPoints ?? 0,
    tagOps: e.payload?.tagOps ?? [],
    // { from: {kind,id,name}, to: {kind,id,name}, amount } — mutually
    // exclusive with `resources`, see StagedEffect.payload in schema.prisma.
    transfer: e.payload?.transfer ?? null,
    locationId: e.payload?.locationId ?? null,
    locationName: e.payload?.locationId
      ? (locationNameById.get(e.payload.locationId) ?? "(deleted location)")
      : null,
    applied: Boolean(e.appliedAt),
    appliedError: e.appliedEffect?.error ?? null,
    createdByUsername: usernameById.get(e.createdByDiscordUserId) ?? e.createdByDiscordUserId,
    createdByDiscordUserId: e.createdByDiscordUserId ?? null,
    turnNumber: e.turn?.number ?? null,
    missed: openTurn ? e.turnId !== openTurn.id && !e.appliedAt : !e.appliedAt,
    // The staged lists are drawn oldest-first — the order they were queued in
    // is the order they push in. The desk store sorts its own rows now
    // (deskStore.js), so the sort key has to ride on the row rather than
    // living only in the ORDER BY page.js happened to ask for.
    createdAtMs: e.createdAt.getTime(),
  };
}

// ctx: { usernameById, openTurn }
export function stagedMessageRow(m, { usernameById, openTurn }) {
  return {
    id: m.id,
    moveId: m.moveId,
    cavingRollId: m.cavingRollId,
    kind: m.kind,
    content: m.content,
    zoneId: m.zoneId,
    zoneName: m.zone?.name ?? null,
    zoneKind: m.zone?.kind ?? null,
    recipients: m.recipients.map((r) => ({
      characterId: r.character.id,
      name: r.character.name,
      avatarVersion: r.character.updatedAt.getTime(),
    })),
    sent: Boolean(m.sentAt),
    deliveryFailures: m.deliveryFailures ?? null,
    // Per-recipient delivery state, newest truth. Empty for a message pushed
    // before the Delivery table existed — the blob above is what those still
    // read, which is why both are here.
    deliveries: (m.deliveries ?? []).map((d) => ({
      characterId: d.characterId,
      name: d.name,
      state: d.state,
      attempts: d.attempts,
      error: d.lastError?.error ?? null,
    })),
    createdByUsername: usernameById.get(m.createdByDiscordUserId) ?? m.createdByDiscordUserId,
    createdByDiscordUserId: m.createdByDiscordUserId ?? null,
    turnNumber: m.turn?.number ?? null,
    missed: openTurn ? m.turnId !== openTurn.id && !m.sentAt : !m.sentAt,
    // See stagedEffectRow above.
    createdAtMs: m.createdAt.getTime(),
  };
}

// A picture waiting to be looked at (docs/systemdocs/PORTRAITS.md §1a).
//
// Not a fight, and that is the point — the lens is named for its shape rather
// than its contents, and this is the next thing that is neither a Move nor a
// die. It shares the row DTO so the lens's search, filters and sort need no
// second vocabulary.
//
// NO ZONE, on purpose. inVisibleZones keeps a row with no zone visible to
// every GM ("better seen twice than by nobody"), which is the right answer for
// a portrait: it belongs to nobody's patch of map, and a picture only the
// Marshes GM can see is a picture nobody reviews.
//
// `avatarData` is never selected into this — it is ~145KB a piece, and the
// browser fetches each face itself through /api/avatar/[characterId].
export const AVATAR_REVIEW_SELECT = {
  id: true,
  name: true,
  discordUserId: true,
  updatedAt: true,
  roleTitle: true,
  avatarSetAt: true,
};

export function avatarReviewRow(c, { usernameById, catatonicIds }) {
  return {
    // Prefixed so it can never collide with an Attack or InterceptHit id in a
    // lens that merges all three into one keyed list.
    id: `avatar:${c.id}`,
    kind: "AVATAR",
    kindLabel: "Portrait",
    characterId: c.id,
    characterName: c.name,
    avatarVersion: c.updatedAt.getTime(),
    catatonic: catatonicIds?.has(c.id) ?? false,
    discordUsername: usernameById.get(c.discordUserId) ?? c.discordUserId ?? "",
    roleTitle: c.roleTitle ?? "",
    targetCharacterId: c.id,
    targetName: c.name,
    extraCount: 0,
    zoneName: "",
    locationName: null,
    statusLabel: "New",
    // A picture is not a scene, so there is nobody to list and nothing to
    // call off — but the fields are present so the lens can read every row it
    // holds with one vocabulary.
    people: [],
    holds: [],
    searchText: c.name,
    createdAtMs: c.avatarSetAt.getTime(),
  };
}

export function cavingRollRow(c, { usernameById, catatonicIds }) {
  const nameFor = usernameById.get(c.character.discordUserId) ?? c.character.discordUserId;
  return {
    id: c.id,
    characterId: c.characterId,
    characterName: c.character.name,
    avatarVersion: c.character.updatedAt.getTime(),
    catatonic: catatonicIds?.has(c.characterId) ?? false,
    discordUsername: nameFor,
    roleTitle: c.character.roleTitle ?? "",
    factionZoneName: c.character.faction?.zone?.name ?? "",
    // Where the die actually rolled, which for a caving row is the only zone
    // that means anything. It used to read the SEAT zone first and fall back
    // to this, so a Factory member (seated in the Marshes) who walked into the
    // Caves produced a roll the lens printed as "Marshes" — and, because
    // inVisibleZones gates on the same value, one a Caves GM could not see at
    // all. A CavingRoll is always in a cave; the seat is beside the point.
    zoneName: c.zone?.name ?? "",
    locationName: c.location?.name ?? null,
    die: c.die,
    kind: c.kind,
    kindLabel: CAVING_KIND_LABELS[c.kind] ?? c.kind,
    lootTier: c.lootTier ?? null,
    lootTagId: c.lootTagId ?? null,
    lootTagName: c.lootTag?.name ?? null,
    lootUndoneAt: c.lootUndoneAt ? c.lootUndoneAt.getTime() : null,
    statusLabel: c.resolvedAt ? "Resolved" : "Needs attention",
    // A TROUBLE roll is created unresolved, and the only hand that resolves one
    // writes its own id — so resolved with no resolver means the turn-end push
    // let it go (db/lib/cavingPass.js#releaseUnresolvedCavingRolls). Worth
    // saying out loud on the desk: nobody adjudicated this, the clock did.
    autoResolved: Boolean(c.resolvedAt) && c.kind === "TROUBLE" && !c.resolvedByDiscordUserId,
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    resolvedByUsername: c.resolvedByDiscordUserId
      ? (usernameById.get(c.resolvedByDiscordUserId) ?? c.resolvedByDiscordUserId)
      : null,
    resolvedAtLabel: c.resolvedAt ? c.resolvedAt.toISOString().slice(0, 16).replace("T", " ") : null,
    gmNotes: c.gmNotes ?? "",
    createdAtMs: c.createdAt.getTime(),
  };
}

// One copy of each distinct held tag across a set of Moves, for TagChip
// rendering — bounded by the catalog, not the row count.
export function tagsByIdFor(actions) {
  const tagsById = {};
  for (const action of actions) {
    for (const ct of action.character.tags) {
      if (!tagsById[ct.tagId]) tagsById[ct.tagId] = ct.tag;
    }
  }
  return tagsById;
}

// stagingReaches lives in ./stagingReach.js so MoveDesk.js can import it
// without dragging this module's Prisma imports into the browser.
export { stagingReaches } from "./stagingReach";
