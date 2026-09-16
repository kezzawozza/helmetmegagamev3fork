// SERVER ONLY: imports the Prisma barrel via referenceData.js. Client-safe helpers go in their own import-free file (stagingReach.js).
import { CATATONIC_SLUG } from "@lifeweb/db/lib/constants";
import { statusWord, WORKING_STATUSES } from "@lifeweb/db/lib/structures";
import { MOVE_PIPELINE_LABELS, MOVE_REVIEW_LABELS, moveKindLabel, isTravelMove, rollLabel } from "@/lib/moves";
import { chipSelect, composeChipTag, GM_CHIP_CTX } from "@/lib/referenceData";
import { CAVING_KIND_LABELS } from "@/lib/cavingLabels";

// The DTO mappers the adjudication desk's queue is built from, one place so the RSC and server-action callers can't drift.
export const MOVE_INCLUDE = {
  character: {
    include: {
      // faction.zone is the ZONE SEAT (never a cave level); `zone` is the PRESENCE zone the desk labels.
      faction: { include: { zone: true } },
      zone: true,
      // Character.locationId is the authoritative "where they stand" (MAP.md §1), so the desk needs it too.
      location: { select: { id: true, name: true } },
      tags: {
        select: {
          tagId: true,
          quantity: true,
          expiresTurn: true,
          // LOAD-BEARING for the Move desk's Combat readout. Both
          // db/lib/fightingSkill.js and db/lib/armorValue.js#combineArmor read
          // a MISSING `equipped` as equipped — deliberate latitude, so a bare
          // Tag[] still resolves — which means dropping the column here does
          // not fail, it silently counts every sword in a sack and every
          // breastplate in a cart.
          equipped: true,
          tag: { select: chipSelect() },
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
  // `kind`: a cave level has no #summary and fans out to its Location channels instead.
  zone: { select: { id: true, name: true, kind: true } },
  turn: { select: { id: true, number: true } },
  // One row per send (db/lib/stagedDelivery.js) — lets the tray say which recipient, and retry state.
  deliveries: true,
};

// The Caving lens' row shape; same single-source rule as the Move rows above. lootTag/lootUndoneAt let a FIND offer Undo (CAVING.md §4).
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
  // The Die rolls once per LOCATION, so the zone alone no longer tells rolls apart — matters for TROUBLE rows a GM narrates.
  location: { select: { name: true } },
  lootTag: { select: { name: true } },
};

function isConfirmed(a) {
  return a.status === "CONFIRMED" || a.status === "ADJUDICATED";
}

// The label is always the review-status label — a live lock renders separately, as presence (QueueRail.js).
export function moveStatusLabel(a, now) {
  if (!isConfirmed(a)) return MOVE_PIPELINE_LABELS[a.status] ?? a.status;
  return MOVE_REVIEW_LABELS[a.moveReviewStatus] ?? "Open";
}

// "+3 ⬢" / "rolled 5–12 ⬢ → +8". "0-0" (a Labor that never paid ⬢, db/lib/laborAccess.js) falls through to null.
export function declaredLabel(a) {
  // The range and the value must drop together or "→ 0 ⬢" is left standing alone.
  const unpaid = a.resourceRollExpression === "0-0";
  const parts = [];
  if (a.resourceRollExpression && !unpaid)
    parts.push(`rolled ${a.resourceRollExpression.replace("-", "–")} ⬢`);
  if (a.resourceDelta != null && !(unpaid && a.resourceDelta === 0))
    parts.push(`${a.resourceDelta > 0 ? "+" : ""}${a.resourceDelta} ⬢`);
  return parts.length ? parts.join(" → ") : null;
}

// What actually paid at the push, same form as db/lib/moveEffects.js#describeMoveEffects, duplicated to avoid a db/lib import.
export function paidLabel(applied) {
  const parts = [];
  for (const [key, value] of Object.entries(applied ?? {})) {
    if (!value) continue;
    if (key === "resources") parts.push(`${value > 0 ? "+" : ""}${value} ⬢`);
    // Legacy rows recorded a bare `1`, meaning a plain Exhausted grant.
    else if (key === "exhausted") parts.push(value?.slug === "tired" ? "Tired" : "Exhausted");
    // Mirrors the laborDrop arm of describeMoveEffects — both halves must learn a new effect key together.
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

// One line per structure. defenseNote prints ONLY while WORKING_STATUSES holds — a ruined Battering Ram must not hand the desk a licence its wreck no longer grants.
const NOTE_STATUSES = new Set(WORKING_STATUSES);

function standingHereLines(structures) {
  if (!structures?.length) return [];
  return structures.map((s) => {
    const note = NOTE_STATUSES.has(s.status) ? s.placement?.defenseNote : null;
    return `${s.typeName} — ${statusWord(s.status)}${note ? `: ${note}` : ""}`;
  });
}

export function moveRow(a, { usernameById, now, structuresByLocationId }) {
  const username = usernameById.get(a.character.discordUserId) ?? a.character.discordUserId;
  return {
    id: a.id,
    characterId: a.characterId,
    characterName: a.character.name,
    avatarVersion: a.character.updatedAt.getTime(),
    // AFK marker for the queue row's avatar badge, read off the tags MOVE_INCLUDE already loads.
    catatonic: a.character.tags.some((ct) => ct.tag?.slug === CATATONIC_SLUG),
    // The player desk keys on discordUserId — carried here so a Move can link straight to that conversation.
    discordUserId: a.character.discordUserId,
    discordUsername: username,
    roleTitle: a.character.roleTitle ?? "",
    factionName: a.character.faction?.name ?? "",
    factionId: a.character.factionId ?? null,
    factionZoneName: a.character.faction?.zone?.name ?? "",
    description: a.description,
    kindLabel: moveKindLabel(a.moveKind, a.gmNotes),
    moveKind: a.moveKind ?? "ROUTINE",
    // Only a CONFIRMED Gambit is ever thrown a die (db/lib/gambitCutoff.js filters on it), so
    // this is what lets the desk say "rolls at lock-in" without promising one to a row that
    // can never get it — an abandoned PENDING_TYPE draft, or a quest Interact, which files
    // through fileMove and is never confirmed.
    confirmed: a.status === "CONFIRMED",
    isTravel: isTravelMove(a.gmNotes),
    gmNotes: a.gmNotes ?? "",
    rollLabel: rollLabel(a),
    statusLabel: moveStatusLabel(a, now),
    // The enum itself, alongside the label — clients branch on this, not the string (MoveDesk.js).
    reviewStatus: a.moveReviewStatus,
    // Key name kept because MoveDesk/InspectorColumn still read `locationLabel` (MAP.md §1).
    locationLabel: a.character.location
      ? `${a.character.zone?.name ?? "?"} · ${a.character.location.name}`
      : a.character.zone?.name || "Unassigned",
    // PublicComposer needs the id to preselect the Move's own zone, not just its name.
    zoneId: a.character.zone?.id ?? null,
    // Per-structure "Standing here" line, bulk-loaded by the caller and keyed by locationId.
    standingHere: standingHereLines(structuresByLocationId?.get(a.character.locationId ?? "")),
    resources: a.character.resources,
    tags: a.character.tags.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      expiresTurn: ct.expiresTurn,
      // See MOVE_INCLUDE above: without this the desk's band reads a stowed
      // weapon as a drawn one.
      equipped: ct.equipped,
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

export function stagedEffectRow(e, { usernameById, locationNameById, openTurn }) {
  return {
    id: e.id,
    moveId: e.moveId,
    cavingRollId: e.cavingRollId,
    batchId: e.batchId,
    // Nullable: an old, pre-Silo-removal faction-to-faction transfer has no character end.
    targetCharacterId: e.targetCharacterId,
    targetName: e.targetCharacterId ? (e.targetCharacter?.name ?? "(deleted)") : null,
    targetAvatarVersion: e.targetCharacter?.updatedAt ? e.targetCharacter.updatedAt.getTime() : null,
    resources: e.payload?.resources ?? 0,
    tagPoints: e.payload?.tagPoints ?? 0,
    tagOps: e.payload?.tagOps ?? [],
    // { from, to, amount } — mutually exclusive with `resources`, see StagedEffect.payload in schema.prisma.
    transfer: e.payload?.transfer ?? null,
    // A room's stash, mutually exclusive with every character key above; read off the payload so it survives the room being pruned.
    room: e.payload?.room ?? null,
    roomTagOps: e.payload?.roomTagOps ?? [],
    roomResources: e.payload?.roomResources ?? 0,
    locationId: e.payload?.locationId ?? null,
    locationName: e.payload?.locationId
      ? (locationNameById.get(e.payload.locationId) ?? "(deleted location)")
      : null,
    // { gib, reason }: a staged death (db/lib/stagedPush.js short-circuits on it); appliedDeath mirrors the write — { claimed: false } is a no-op, not a failure.
    death: e.payload?.death ? { gib: e.payload.gib === true, reason: e.payload.reason ?? null } : null,
    appliedDeath: e.appliedEffect?.death ?? null,
    applied: Boolean(e.appliedAt),
    appliedError: e.appliedEffect?.error ?? null,
    createdByUsername: usernameById.get(e.createdByDiscordUserId) ?? e.createdByDiscordUserId,
    createdByDiscordUserId: e.createdByDiscordUserId ?? null,
    turnNumber: e.turn?.number ?? null,
    missed: openTurn ? e.turnId !== openTurn.id && !e.appliedAt : !e.appliedAt,
    // The desk store sorts its own rows (deskStore.js), so the sort key rides on the row, not the query's ORDER BY.
    createdAtMs: e.createdAt.getTime(),
  };
}

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
    // Per-recipient delivery state; empty for a pre-Delivery-table message, which reads deliveryFailures instead.
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
    createdAtMs: m.createdAt.getTime(),
  };
}

// A picture waiting to be looked at (docs/systemdocs/PORTRAITS.md §1a). NO ZONE on purpose: inVisibleZones keeps a zoneless row visible to every GM.
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
    // Prefixed so it can never collide with an Attack or InterceptHit id in a merged lens.
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
    // Nobody to list, nothing to call off — present so the lens can read every row with one vocabulary.
    people: [],
    holds: [],
    searchText: c.name,
    createdAtMs: c.avatarSetAt.getTime(),
  };
}

// A fulfilled, catalog-backed Desire claim waiting on a GM (DESIRES.md §6, db/lib/desireReview.js). Unlike the
// portrait queue, an ALREADY-REVIEWED row stays: `desireReviewWhere()` doesn't filter on `reviewedAt`.
export const DESIRE_CLAIM_INCLUDE = {
  template: { select: { name: true, tier: true, verifyQuery: true } },
  character: {
    select: {
      id: true,
      name: true,
      updatedAt: true,
      zoneId: true,
      zone: { select: { name: true } },
      discordUserId: true,
    },
  },
};

export function desireClaimRow(d, { usernameById, catatonicIds } = {}) {
  const c = d.character;
  const reviewed = Boolean(d.reviewedAt);
  return {
    id: d.id,
    characterId: c.id,
    characterName: c.name,
    avatarVersion: c.updatedAt.getTime(),
    catatonic: catatonicIds?.has(c.id) ?? false,
    discordUsername: usernameById?.get?.(c.discordUserId) ?? "",
    zoneId: c.zoneId ?? null,
    zoneName: c.zone?.name ?? "",
    desireName: d.text,
    tier: d.template?.tier ?? null,
    points: d.points,
    slotIndex: d.slotIndex,
    turnNumber: d.setTurnNumber,
    reason: d.reason ?? "",
    reviewedAt: reviewed ? d.reviewedAt.getTime() : null,
    verifyQuery: d.template?.verifyQuery ?? "",
    statusLabel: reviewed ? "Reviewed" : "Waiting",
    searchText: `${c.name} ${d.text}`,
    createdAtMs: d.createdAt.getTime(),
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
    // Where the die actually rolled — the only zone that means anything for a caving row; the seat is beside the point.
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
    // Resolved with no resolver means the turn-end push let it go (db/lib/cavingPass.js#releaseUnresolvedCavingRolls).
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
// rendering. moveRow() itself ships no tag object (just tagId/quantity), so
// THIS is the desk's single funnel for what a chip knows — and therefore where
// the compose belongs. Without it a paper tag arrives with a null description
// and hovers blank, which is what /gm/turns did. GM context: a GM reads a
// letter ungated (paperViewGm), same as every other desk surface.
export function tagsByIdFor(actions) {
  const tagsById = {};
  for (const action of actions) {
    for (const ct of action.character.tags) {
      if (!tagsById[ct.tagId]) tagsById[ct.tagId] = composeChipTag(ct.tag, GM_CHIP_CTX);
    }
  }
  return tagsById;
}

// stagingReaches lives in ./stagingReach.js so MoveDesk.js can import it without this module's Prisma imports.
export { stagingReaches } from "./stagingReach";
