"use server";

import { revalidatePath } from "next/cache";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { after } from "next/server";
import { prisma, Prisma, revertMoveEffects } from "@lifeweb/db";
import { ensureGambitDie } from "@lifeweb/db/lib/gambitDie";
import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { TagOpError, validateTagOps } from "@lifeweb/db/lib/tagOps";
import { validateRoomTagOps } from "@lifeweb/db/lib/roomTagOps";
import { resolveParty, partyLabel } from "@lifeweb/db/lib/parties";
import { resourcesOf, withoutResources } from "@lifeweb/db/lib/resourceStack";
import { getVisibleZones } from "@/lib/gmZoneView";
// By path, not off the barrel — the db/lib/dm.js convention this module follows.
import {
  backfillLegacyDeliveries,
  deliverPrivate,
  deliverPublic,
  failuresFor,
  isRetryable,
} from "@lifeweb/db/lib/stagedDelivery";
import { publicPostTargets } from "@lifeweb/db/lib/publicPostTargets";
// By path too, the db/lib/dm.js convention: neither is on the @lifeweb/db barrel.
import { broadcastDecree } from "@lifeweb/db/lib/decree";
import { DECREE_BODY_MAX, DECREE_TITLE_MAX } from "@lifeweb/db/lib/decreeText";
import { getGmSession, killCharacter, listGuildMembers, sendDm } from "@/lib/discordGuild";
import { DesireRevokeRefused, revokeDesireCore } from "@lifeweb/db/lib/desireReview";
import { getGmProfiles } from "@/lib/gmProfiles";
import { turnAt } from "@/lib/auditQuery";
import { dropCharacterTag } from "@/lib/tagEffects";
import { UserError, guarded } from "@/lib/actionResult";
import { muteDurationLabel, oocMuteFor } from "@lifeweb/db/lib/ooc";
import { deleteActionRestoringTurn, MOVE_LOCK_TTL_MS, lockIsLive } from "@/lib/moveEconomy";
import { GM_MESSAGE_MAX_LENGTH, MAX_REASON_LENGTH } from "@/lib/constants";
import { chipSelect, composeChipTag, GM_CHIP_CTX } from "@/lib/referenceData";
import { MOVE_REVIEW_LABELS, moveKindLabel, rollLabel } from "@/lib/moves";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  CAVING_ROLL_INCLUDE,
  declaredLabel,
  moveRow,
  paidLabel,
  stagedEffectRow,
  stagedMessageRow,
  cavingRollRow,
  tagsByIdFor,
} from "@/lib/moveRows";
import { deskPatchFor } from "@/lib/deskRows";
import { DM_KIND } from "@lifeweb/db/lib/dmKinds";
// Required by path, not off the @lifeweb/db barrel: db/lib/attack.js is
// deliberately not on it (the db/lib/dm.js convention).
import { cancelAttack } from "@lifeweb/db/lib/attack";

// EVERY MUTATION HERE HANDS BACK THE ROWS IT CHANGED, as `patch` — the shape
// web/lib/deskRows.js#deskPatchFor builds and the client's desk store folds in
// (deskStore.js). The desk used to write, then ask the router to fetch the
// whole page again and hope; when that refresh didn't come back the write had
// landed and the screen never said so. A patch costs one small re-read and
// removes the hope.
//
// Server actions for the adjudication workspace (/gm/turns). Staged rows
// apply and deliver only at the turn-end push (db/lib/stagedPush.js);
// exceptions that act now: Reject, the FEED_PERSON kill, Request review.

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new UserError("Not authenticated.");
  if (!gm) throw new UserError("Not authorized.");
  return session;
}

// Fat-finger guard, not a player clamp — GM-staged payouts sanction past the
// player-side ±20.
const MAX_STAGED_RESOURCES = 500;
const MAX_STAGED_TAG_POINTS = 100;

async function requireOpenTurn() {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) throw new UserError("No turn is open.");
  return openTurn;
}

// Turn-boundary race: a row created around the cron can land on a turn the
// push already swept. Re-read and retarget to the new open turn.
async function retargetIfTurnClosed(model, ids, turnId) {
  const still = await prisma.turn.findFirst({ where: { id: turnId, status: "OPEN" } });
  if (still) return;
  const fresh = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!fresh) return;
  await model.updateMany({ where: { id: { in: ids } }, data: { turnId: fresh.id } });
}

function normalizeMessageContent(raw) {
  const content = raw?.toString().trim() ?? "";
  if (!content) throw new UserError("Write the message first.");
  if (content.length > GM_MESSAGE_MAX_LENGTH) {
    throw new UserError(`Messages cap at ${GM_MESSAGE_MAX_LENGTH} characters.`);
  }
  return content;
}

async function normalizeRecipients(recipientCharacterIds) {
  const ids = [...new Set((recipientCharacterIds ?? []).filter(Boolean))];
  if (!ids.length) throw new UserError("Pick at least one recipient.");
  const found = await prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new UserError("One of those characters no longer exists.");
  return ids;
}

async function createStagedMessageImpl({ kind, content, recipientCharacterIds, moveId, cavingRollId, zoneId }) {
  const session = await requireGm();
  if (!["PRIVATE", "PUBLIC"].includes(kind)) throw new UserError("Unknown message kind.");
  const text = normalizeMessageContent(content);
  const openTurn = await requireOpenTurn();

  const recipients = kind === "PRIVATE" ? await normalizeRecipients(recipientCharacterIds) : [];
  if (kind === "PUBLIC" && !zoneId) throw new UserError("Pick a zone.");

  const row = await prisma.stagedMessage.create({
    data: {
      turnId: openTurn.id,
      moveId: moveId || null,
      cavingRollId: cavingRollId || null,
      kind,
      content: text,
      zoneId: (kind === "PUBLIC" && zoneId) || null,
      createdByDiscordUserId: session.discordUserId,
      recipients: { create: recipients.map((characterId) => ({ characterId })) },
    },
  });
  await retargetIfTurnClosed(prisma.stagedMessage, [row.id], openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_created",
      details: {
        stagedMessageId: row.id,
        kind,
        moveId: moveId || null,
        cavingRollId: cavingRollId || null,
        recipients: recipients.length,
      },
    },
  });

  return { id: row.id, patch: await deskPatchFor({ stagedMessageIds: [row.id] }) };
}

async function updateStagedMessageImpl({ stagedMessageId, content, recipientCharacterIds, zoneId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({ where: { id: stagedMessageId ?? "" } });
  if (!existing) throw new UserError("That staged message is gone.");
  if (existing.sentAt) throw new UserError("That message already went out — it can't be edited.");

  const text = normalizeMessageContent(content);
  const recipients = existing.kind === "PRIVATE" ? await normalizeRecipients(recipientCharacterIds) : null;
  if (existing.kind === "PUBLIC" && !zoneId) throw new UserError("Pick a zone.");

  await prisma.$transaction(async (tx) => {
    // Conditional on sentAt: an edit racing the push loses cleanly.
    const claimed = await tx.stagedMessage.updateMany({
      where: { id: existing.id, sentAt: null },
      data: {
        content: text,
        ...(existing.kind === "PUBLIC" ? { zoneId: zoneId || null } : {}),
      },
    });
    if (!claimed.count) throw new UserError("That message just went out — it can't be edited.");
    if (recipients) {
      await tx.stagedMessageRecipient.deleteMany({ where: { stagedMessageId: existing.id } });
      await tx.stagedMessageRecipient.createMany({
        data: recipients.map((characterId) => ({ stagedMessageId: existing.id, characterId })),
      });
    }
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_updated",
      details: { stagedMessageId: existing.id },
    },
  });

  return { patch: await deskPatchFor({ stagedMessageIds: [existing.id] }) };
}

async function deleteStagedMessageImpl({ stagedMessageId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({ where: { id: stagedMessageId ?? "" } });
  // Already gone — say so as a removal rather than as nothing, so a desk still
  // showing the row drops it.
  if (!existing) {
    return { patch: await deskPatchFor({ removed: { stagedMessageIds: [stagedMessageId].filter(Boolean) } }) };
  }
  if (existing.sentAt) throw new UserError("That message already went out.");

  await prisma.stagedMessage.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_deleted",
      details: { stagedMessageId: existing.id, kind: existing.kind, content: existing.content.slice(0, 200) },
    },
  });

  return { patch: await deskPatchFor({ removed: { stagedMessageIds: [existing.id] } }) };
}

// ------------------------------------------------------------------ decree

// `/decree` in the chat composer (web/app/(app)/chat/commands.js), which
// opens DecreeComposer.js the same way this desk's own retired Decree button
// used to. NOT a staged row:
// a decree goes out the moment it is sent, the way the intercom does, because a
// proclamation held until midnight is a proclamation about yesterday. Nothing on
// the desk changes, so there is no patch to hand back — only what happened, so
// the composer can say which zones heard it.
async function sendDecreeImpl({ title, body, zoneIds }) {
  const session = await requireGm();

  // Validated against Discord's OWN embed caps rather than the desk's
  // GM_MESSAGE_MAX_LENGTH: this goes out as an embed, and 4097 characters is
  // rejected by the API rather than split (db/lib/decreeText.js). Refused, never
  // truncated — a GM must not find out a sentence went missing by reading it in
  // the channel.
  const head = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!head) throw new UserError("Give the decree a title.");
  if (head.length > DECREE_TITLE_MAX) {
    throw new UserError(`A decree's title caps at ${DECREE_TITLE_MAX} characters.`);
  }
  const text = String(body ?? "").trim();
  if (!text) throw new UserError("Write the decree first.");
  if (text.length > DECREE_BODY_MAX) {
    throw new UserError(`A decree caps at ${DECREE_BODY_MAX} characters.`);
  }

  const ids = [...new Set((zoneIds ?? []).filter(Boolean))];
  if (ids.length === 0) throw new UserError("Pick at least one zone.");
  // PRESENCE zones only, the same rule the public-declaration picker follows:
  // the abstract Caves group row is not a place anybody is standing in.
  const zones = await prisma.zone.findMany({
    where: { id: { in: ids }, kind: { not: "CAVE_GROUP" } },
    select: { id: true },
  });
  if (zones.length !== ids.length) throw new UserError("One of those zones no longer exists.");

  const result = await broadcastDecree(prisma, { title: head, body: text, zoneIds: zones.map((z) => z.id) });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "decree_broadcast",
      details: {
        title: head,
        // The words, bounded — a full 4096-character decree in a details blob
        // is a log row nobody can read past.
        body: text.slice(0, 500),
        zones: result.zones.map((z) => z.zoneName),
        zonesReached: result.sent,
        zonesFailed: result.failed,
      },
    },
  });

  return { zones: result.zones, sent: result.sent, posted: result.posted, failed: result.failed };
}

// Retries a sent-but-partially-failed staged message. PRIVATE re-sends only
// the failed recipients; PUBLIC re-posts to whichever channels bounced — the
// summary channel, or the Location channels of a cave level. A clean
// resend clears deliveryFailures with Prisma.DbNull, not JS null.
async function resendStagedMessageImpl({ stagedMessageId }) {
  const session = await requireGm();
  const existing = await prisma.stagedMessage.findUnique({
    where: { id: stagedMessageId ?? "" },
    include: {
      recipients: { include: { character: { select: { id: true, name: true, discordUserId: true } } } },
      // The channel is resolved by publicPostTargets below; kind and name
      // are for the sentence a GM reads when there is nowhere to post.
      zone: { select: { name: true, kind: true } },
      deliveries: true,
    },
  });
  if (!existing) throw new UserError("That staged message is gone.");
  if (!existing.sentAt) throw new UserError("That message hasn't gone out yet.");

  const recipients = existing.recipients.map((r) => ({
    characterId: r.character.id,
    name: r.character.name,
    discordUserId: r.character.discordUserId,
  }));
  const priorFailures = Array.isArray(existing.deliveryFailures) ? existing.deliveryFailures : [];

  // A message pushed BEFORE the Delivery table existed has a sentAt and no rows
  // at all, and production is full of them. Writing them fresh would make them
  // PENDING — which reads as "never attempted" — and Resend would then re-DM
  // every recipient who had already read the thing, or re-post a declaration
  // that is already sitting in the channel. So the old state is reconstructed
  // first, from the only two things the old code wrote down: sentAt says
  // everyone was attempted, and the blob names who bounced.
  let deliveries = existing.deliveries;
  if (!deliveries.length) {
    await backfillLegacyDeliveries(prisma, {
      stagedMessage: existing,
      recipients,
      priorFailures,
    });
    deliveries = await prisma.delivery.findMany({
      where: { stagedMessageId: existing.id },
      orderBy: { createdAt: "asc" },
    });
  }

  // Retryable, not merely FAILED: a row a killed push stranded IN_FLIGHT past
  // the stale window is a bounce that never got to say so, and refusing to
  // resend it leaves the recipient with nothing and the GM with no button.
  const retryable = deliveries.filter((d) => d.state !== "SENT" && isRetryable(d));
  if (!retryable.length) throw new UserError("Nothing failed on that message.");

  let resent = 0;
  let stillFailing = [];
  let held = 0;

  if (existing.kind === "PRIVATE") {
    // The push's own code path (db/lib/stagedDelivery.js), not a second copy
    // of it. Each recipient is claimed before their DM, so pressing Resend
    // while a push is still running retries nobody twice — and `onlyFailed` is
    // now unconditional, because the rows are the whole truth for a legacy
    // message too. There is never a reason for Resend to reach a recipient the
    // table does not say needs reaching.
    const { sent, skipped } = await deliverPrivate(prisma, {
      stagedMessage: existing,
      recipients,
      onlyFailed: true,
    });
    resent = sent.length;
    held = skipped.length;
    // Derived from the rows, not from this run: a recipient a concurrent push
    // just got through to must not still be listed as failing here.
    stillFailing = await failuresFor(prisma, existing.id);
  } else {
    // One #summary for a surface zone; every Location channel for a cave
    // level, which has none (db/lib/publicPostTargets.js, ADJUDICATION.md §1).
    const { zone, targets } = await publicPostTargets(prisma, existing.zoneId);
    if (!targets.length) {
      throw new UserError(
        zone?.kind === "CAVE_LEVEL"
          ? "That cave has no Location channels to post into yet."
          : "That zone has no summary channel configured.",
      );
    }
    // A declaration that reached Discord already has its Hall row; one that
    // never posted has none, and a resend is the only thing that will write
    // it. Still one question even now that a run can land partly: any SENT row
    // means a run where something went out, and that run wrote the row.
    const posted = deliveries.some((d) => d.state === "SENT");
    const { sent, skipped } = await deliverPublic(prisma, {
      stagedMessage: existing,
      targets,
      zone,
      zoneId: existing.zoneId,
      writeSceneLine: !posted,
    });
    resent = sent;
    // A count now, not a boolean — a fan-out can have several channels held by
    // a push running right now.
    held = skipped;
    // Derived from the rows, the same way PRIVATE does it. The raw `failed`
    // this used to return is only ever this run's own bounce, so a post that
    // failed here and was retried by a push a second later stayed listed as
    // failing and the blob disagreed with the row.
    stillFailing = await failuresFor(prisma, existing.id);
  }

  await prisma.stagedMessage.update({
    where: { id: existing.id },
    data: { deliveryFailures: stillFailing.length ? stillFailing : Prisma.DbNull },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_message_resent",
      details: {
        stagedMessageId: existing.id,
        kind: existing.kind,
        attempted: resent + stillFailing.length + held,
        delivered: resent,
        stillFailing: stillFailing.length,
        // Claimed by a push running right now. Neither sent nor bounced, and
        // the GM's counts have to add up or the row reads as lost mail.
        held,
      },
    },
  });

  return { resent, stillFailing, held, patch: await deskPatchFor({ stagedMessageIds: [existing.id] }) };
}

// The composer stages presence ops only (add/remove). Patch and equip belong
// to the Dev Panel's full editor.
function normalizeStagedOps(tagOps) {
  const ops = Array.isArray(tagOps) ? tagOps : [];
  return ops.map((op) => {
    if (!op?.tagId || !["add", "remove"].includes(op.op)) {
      throw new UserError("Only add and remove can be staged here.");
    }
    const quantity = op.quantity == null ? null : Number.parseInt(op.quantity, 10);
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 1)) {
      throw new UserError("Quantities must be whole numbers of at least 1.");
    }
    return { tagId: op.tagId, op: op.op, ...(quantity != null ? { quantity } : {}) };
  });
}

function normalizeStagedResources(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new UserError("Resources must be a number.");
  if (Math.abs(n) > MAX_STAGED_RESOURCES) {
    throw new UserError(`That's over the ±${MAX_STAGED_RESOURCES} ⬢ sanity cap — stage it in parts if you mean it.`);
  }
  return n;
}

function normalizeStagedTagPoints(raw) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new UserError("Tag points must be a number.");
  if (Math.abs(n) > MAX_STAGED_TAG_POINTS) {
    throw new UserError(`That's over the ±${MAX_STAGED_TAG_POINTS} tag-point sanity cap.`);
  }
  return n;
}

// The composer's "Relocate to" select. Raw relocation — no Action row, Move
// cost, adjacency check or walk cooldown (deliberately not
// performLocationMove). The push writes Character.zoneId off the Location, so
// only the Location id is staged.
async function normalizeStagedLocation(raw) {
  const locationId = raw?.toString().trim() || null;
  if (!locationId) return null;
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new UserError("That location no longer exists.");
  return locationId;
}

// The room composer stages presence ops too, but through roomTagOps.js'
// validator rather than tagOps.js'. The difference that matters: a room takes
// any quantity of a non-stackable tag, because the pin is a rule about what
// one CHARACTER can hold (docs/systemdocs/TAGS.md §5a). Running these through
// normalizeStagedOps would refuse a second Longbow on a floor.
function normalizeStagedRoomOps(tagOps) {
  const ops = Array.isArray(tagOps) ? tagOps : [];
  return ops.map((op) => {
    const quantity = op?.quantity == null ? null : Number.parseInt(op.quantity, 10);
    return { tagId: op?.tagId, op: op?.op, ...(quantity != null ? { quantity } : {}) };
  });
}

async function createStagedEffectsImpl({ targetCharacterIds, moveId, cavingRollId, resources, tagPoints, tagOps, locationId }) {
  const session = await requireGm();
  const targets = [...new Set((targetCharacterIds ?? []).filter(Boolean))];
  if (!targets.length) throw new UserError("Pick at least one target.");

  const delta = normalizeStagedResources(resources);
  const points = normalizeStagedTagPoints(tagPoints);
  const ops = normalizeStagedOps(tagOps);
  const place = await normalizeStagedLocation(locationId);
  if (!delta && !points && !ops.length && !place) {
    throw new UserError("Stage a resource, tag-point, tag change, or relocation.");
  }

  // Validated now with the same engine the push runs, so they can't disagree.
  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateTagOps(ops, new Map(tags.map((t) => [t.id, t])), new Set());
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  const found = await prisma.character.findMany({ where: { id: { in: targets } }, select: { id: true } });
  if (found.length !== targets.length) throw new UserError("One of those characters no longer exists.");

  const openTurn = await requireOpenTurn();
  const batchId = targets.length > 1 ? crypto.randomUUID() : null;
  const payload = {
    ...(delta ? { resources: delta } : {}),
    ...(points ? { tagPoints: points } : {}),
    ...(ops.length ? { tagOps: ops } : {}),
    ...(place ? { locationId: place } : {}),
  };

  const created = await prisma.$transaction(
    targets.map((targetCharacterId) =>
      prisma.stagedEffect.create({
        data: {
          turnId: openTurn.id,
          moveId: moveId || null,
          cavingRollId: cavingRollId || null,
          targetCharacterId,
          createdByDiscordUserId: session.discordUserId,
          batchId,
          payload,
        },
        select: { id: true },
      }),
    ),
  );
  await retargetIfTurnClosed(prisma.stagedEffect, created.map((r) => r.id), openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_created",
      details: { batchId, targets: targets.length, moveId: moveId || null, payload },
    },
  });

  return {
    count: created.length,
    batchId,
    patch: await deskPatchFor({ stagedEffectIds: created.map((r) => r.id) }),
  };
}

// Free text, required: it drives the archive row, the death DM and the
// #leave rollup line all at once (db/lib/stagedPush.js), so an empty one
// would produce a broken sentence in all three.
function normalizeStagedDeathReason(raw) {
  const reason = raw?.toString().trim() ?? "";
  if (!reason) throw new UserError("Say how they died — it's what the death DM and the #leave post read.");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new UserError(`That's over the ${MAX_REASON_LENGTH}-character cap.`);
  }
  return reason;
}

// A staged death — GM-adjudicated, fires at the push via
// db/lib/characterDeath.js#applyDeathToRow (db/lib/stagedPush.js). One row
// per target, same mass-apply shape createStagedEffectsImpl uses above: no
// resources/tagPoints/tagOps/locationId key ever rides alongside `death` —
// the character has no further sheet to write to, and the push
// short-circuits on it before considering any other key.
async function createStagedDeathsImpl({ targetCharacterIds, moveId, cavingRollId, reason, gib }) {
  const session = await requireGm();
  const targets = [...new Set((targetCharacterIds ?? []).filter(Boolean))];
  if (!targets.length) throw new UserError("Pick at least one character.");

  const text = normalizeStagedDeathReason(reason);
  const vaporize = gib === true;

  const found = await prisma.character.findMany({ where: { id: { in: targets } }, select: { id: true } });
  if (found.length !== targets.length) throw new UserError("One of those characters no longer exists.");

  const openTurn = await requireOpenTurn();
  const batchId = targets.length > 1 ? crypto.randomUUID() : null;
  const payload = { death: true, gib: vaporize, reason: text };

  const created = await prisma.$transaction(
    targets.map((targetCharacterId) =>
      prisma.stagedEffect.create({
        data: {
          turnId: openTurn.id,
          moveId: moveId || null,
          cavingRollId: cavingRollId || null,
          targetCharacterId,
          createdByDiscordUserId: session.discordUserId,
          batchId,
          payload,
        },
        select: { id: true },
      }),
    ),
  );
  await retargetIfTurnClosed(prisma.stagedEffect, created.map((r) => r.id), openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_created",
      details: { batchId, targets: targets.length, moveId: moveId || null, payload },
    },
  });

  return {
    count: created.length,
    batchId,
    patch: await deskPatchFor({ stagedEffectIds: created.map((r) => r.id) }),
  };
}

// A staged character-to-character transfer. Separate from
// createStagedEffectsImpl because the balance check runs against live
// balances at stage time, not a mint/burn delta.
async function createStagedTransferImpl({
  fromKey,
  toKey,
  amount: rawAmount,
  moveId,
  cavingRollId,
}) {
  const session = await requireGm();
  const amount = Number.parseInt(rawAmount, 10);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("Amount must be a positive whole number.");
  if (amount > MAX_STAGED_RESOURCES) {
    throw new UserError(`That's over the ±${MAX_STAGED_RESOURCES} ⬢ sanity cap — stage it in parts if you mean it.`);
  }

  const [from, to] = await Promise.all([resolveParty(prisma, fromKey), resolveParty(prisma, toKey)]);
  if (!from) throw new UserError("Unknown source.");
  if (!to) throw new UserError("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id) throw new UserError("Source and recipient are the same.");
  if (amount > from.balance) throw new UserError(`${partyLabel(from)} only has ${from.balance} ⬢.`);

  const openTurn = await requireOpenTurn();
  const targetCharacterId = to.kind === "character" ? to.id : from.kind === "character" ? from.id : null;
  // Snapshotted into the payload, never re-derived at push time.
  const payload = {
    transfer: {
      from: { kind: from.kind, id: from.id, name: from.name },
      to: { kind: to.kind, id: to.id, name: to.name },
      amount,
    },
  };

  const created = await prisma.stagedEffect.create({
    data: {
      turnId: openTurn.id,
      moveId: moveId || null,
      cavingRollId: cavingRollId || null,
      targetCharacterId,
      createdByDiscordUserId: session.discordUserId,
      payload,
    },
    select: { id: true },
  });
  await retargetIfTurnClosed(prisma.stagedEffect, [created.id], openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_created",
      details: { targets: 1, moveId: moveId || null, payload },
    },
  });

  return { id: created.id, patch: await deskPatchFor({ stagedEffectIds: [created.id] }) };
}

// Resolves the room and re-checks every gate the picker already applied — a
// server action is a public endpoint, and the <select> is a hint, not a lock.
// Shared by create and update so the two can't drift.
async function requireStagedRoom(roomId, session, { writingIn = false } = {}) {
  const room = await resolveParty(prisma, `room:${roomId?.toString().trim() ?? ""}`);
  if (!room) throw new UserError("That room no longer exists.");

  // A GM only stages into zones they've chosen to see. Null means every zone
  // (web/lib/gmZoneView.js) — a GM who never touched the control is not
  // locked out of anything.
  const visible = await getVisibleZones();
  if (visible && !visible.some((z) => z.id === room.zoneId)) {
    throw new UserError("That room is outside the zones you're watching.");
  }

  // The Godard Factory's Spillway. moveParty and addRoomResources both
  // silently swallow anything put into it, which is right for a player tipping
  // something into the trough on purpose and wrong for a GM staging an
  // adjudication — they'd watch the row apply and change nothing. Removes and
  // burns stay legal, the same asymmetry db/lib/resourceTransfer.js encodes.
  if (writingIn && room.destroysContents) {
    throw new UserError(`${room.name} destroys whatever is put into it — you can only take things out.`);
  }
  return room;
}

// A staged change to a room's stash: tags on the floor and the room's own ⬢
// (docs/systemdocs/CARRY.md). Separate from createStagedEffectsImpl because
// that function is targets-shaped throughout — multi-target, batchId, the
// character existence check — and a room row is one room, like a transfer.
// It carries NO character keys and leaves targetCharacterId null, so it falls
// straight through every branch of the push before its own.
async function createStagedRoomEffectImpl({ roomId, moveId, cavingRollId, roomResources, tagOps }) {
  const session = await requireGm();

  const delta = normalizeStagedResources(roomResources);
  const ops = normalizeStagedRoomOps(tagOps);
  if (!delta && !ops.length) throw new UserError("Stage a tag change or some ⬢.");

  const room = await requireStagedRoom(roomId, session, {
    writingIn: delta > 0 || ops.some((o) => o.op === "add"),
  });

  // Validated now with the same engine the push runs, so they can't disagree.
  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateRoomTagOps(ops, new Map(tags.map((t) => [t.id, t])));
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  const openTurn = await requireOpenTurn();
  // Names snapshotted at staging time, the transfer precedent: the desk reads
  // the label straight off the payload, so a room deleted before the push
  // still says what the GM staged.
  const payload = {
    room: { id: room.id, name: room.name, locationName: room.locationName },
    ...(ops.length ? { roomTagOps: ops } : {}),
    ...(delta ? { roomResources: delta } : {}),
  };

  const created = await prisma.stagedEffect.create({
    data: {
      turnId: openTurn.id,
      moveId: moveId || null,
      cavingRollId: cavingRollId || null,
      targetCharacterId: null,
      createdByDiscordUserId: session.discordUserId,
      payload,
    },
    select: { id: true },
  });
  await retargetIfTurnClosed(prisma.stagedEffect, [created.id], openTurn.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_created",
      details: { targets: 1, moveId: moveId || null, payload },
    },
  });

  return { id: created.id, patch: await deskPatchFor({ stagedEffectIds: [created.id] }) };
}

// Editing a room row rewrites what it does, never which room it does it to —
// the target is fixed once staged, exactly as a character row's is.
async function updateStagedRoomEffectImpl({ stagedEffectId, roomResources, tagOps }) {
  const session = await requireGm();
  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) throw new UserError("That staged effect is gone.");
  if (existing.appliedAt) throw new UserError("That effect already applied — it can't be edited.");
  const room = existing.payload?.room ?? null;
  if (!room) throw new UserError("That isn't a room effect.");

  const delta = normalizeStagedResources(roomResources);
  const ops = normalizeStagedRoomOps(tagOps);
  if (!delta && !ops.length) throw new UserError("Stage a tag change or some ⬢.");

  // Re-resolved rather than trusted from the payload: the zone seat and the
  // Spillway flag are both live state, and the row may have sat here a while.
  await requireStagedRoom(room.id, session, {
    writingIn: delta > 0 || ops.some((o) => o.op === "add"),
  });

  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateRoomTagOps(ops, new Map(tags.map((t) => [t.id, t])));
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  const claimed = await prisma.stagedEffect.updateMany({
    where: { id: existing.id, appliedAt: null },
    data: {
      payload: {
        room,
        ...(ops.length ? { roomTagOps: ops } : {}),
        ...(delta ? { roomResources: delta } : {}),
      },
    },
  });
  if (!claimed.count) throw new UserError("That effect just applied — it can't be edited.");

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effect_updated",
      details: { stagedEffectId: existing.id },
    },
  });

  return { patch: await deskPatchFor({ stagedEffectIds: [existing.id] }) };
}

async function updateStagedEffectImpl({ stagedEffectId, resources, tagPoints, tagOps, locationId }) {
  const session = await requireGm();
  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) throw new UserError("That staged effect is gone.");
  if (existing.appliedAt) throw new UserError("That effect already applied — it can't be edited.");

  const delta = normalizeStagedResources(resources);
  const points = normalizeStagedTagPoints(tagPoints);
  const ops = normalizeStagedOps(tagOps);
  const place = await normalizeStagedLocation(locationId);
  if (!delta && !points && !ops.length && !place) {
    throw new UserError("Stage a resource, tag-point, tag change, or relocation.");
  }
  if (ops.length) {
    const tags = await prisma.tag.findMany({ where: { id: { in: ops.map((o) => o.tagId) } } });
    try {
      validateTagOps(ops, new Map(tags.map((t) => [t.id, t])), new Set());
    } catch (err) {
      if (err instanceof TagOpError) throw new UserError(err.message);
      throw err;
    }
  }

  // Editing detaches the row from its batch — it no longer matches siblings.
  const claimed = await prisma.stagedEffect.updateMany({
    where: { id: existing.id, appliedAt: null },
    data: {
      payload: {
        ...(delta ? { resources: delta } : {}),
        ...(points ? { tagPoints: points } : {}),
        ...(ops.length ? { tagOps: ops } : {}),
        ...(place ? { locationId: place } : {}),
      },
      batchId: null,
    },
  });
  if (!claimed.count) throw new UserError("That effect just applied — it can't be edited.");

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effect_updated",
      details: { stagedEffectId: existing.id },
    },
  });

  return { patch: await deskPatchFor({ stagedEffectIds: [existing.id] }) };
}

async function updateStagedDeathImpl({ stagedEffectId, reason, gib }) {
  const session = await requireGm();
  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) throw new UserError("That staged effect is gone.");
  if (existing.appliedAt) throw new UserError("That effect already applied — it can't be edited.");
  if (!existing.payload?.death) throw new UserError("That isn't a staged death.");

  const text = normalizeStagedDeathReason(reason);
  const vaporize = gib === true;

  const claimed = await prisma.stagedEffect.updateMany({
    where: { id: existing.id, appliedAt: null },
    data: { payload: { death: true, gib: vaporize, reason: text }, batchId: null },
  });
  if (!claimed.count) throw new UserError("That effect just applied — it can't be edited.");

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effect_updated",
      details: { stagedEffectId: existing.id },
    },
  });

  return { patch: await deskPatchFor({ stagedEffectIds: [existing.id] }) };
}

async function deleteStagedEffectImpl({ stagedEffectId, batchId }) {
  const session = await requireGm();

  if (batchId) {
    // Read the ids before deleting them: a deleteMany count tells the desk how
    // many rows went, not which, and the patch has to name each one.
    const doomed = await prisma.stagedEffect.findMany({
      where: { batchId, appliedAt: null },
      select: { id: true },
    });
    const { count } = await prisma.stagedEffect.deleteMany({ where: { batchId, appliedAt: null } });
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "staged_effects_deleted",
        details: { batchId, count },
      },
    });
    return {
      count,
      patch: await deskPatchFor({ removed: { stagedEffectIds: doomed.map((d) => d.id) } }),
    };
  }

  const existing = await prisma.stagedEffect.findUnique({ where: { id: stagedEffectId ?? "" } });
  if (!existing) {
    return {
      count: 0,
      patch: await deskPatchFor({ removed: { stagedEffectIds: [stagedEffectId].filter(Boolean) } }),
    };
  }
  if (existing.appliedAt) throw new UserError("That effect already applied.");
  await prisma.stagedEffect.delete({ where: { id: existing.id } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staged_effects_deleted",
      details: { stagedEffectId: existing.id, count: 1 },
    },
  });
  return { count: 1, patch: await deskPatchFor({ removed: { stagedEffectIds: [existing.id] } }) };
}

// Moves staged rows a resolved turn's push never got to onto the open turn.
async function retargetMissedStagingImpl({ effectIds = [], messageIds = [] }) {
  const session = await requireGm();
  const openTurn = await requireOpenTurn();

  const [effects, messages] = await Promise.all([
    effectIds.length
      ? prisma.stagedEffect.updateMany({
          where: { id: { in: effectIds }, appliedAt: null },
          data: { turnId: openTurn.id },
        })
      : { count: 0 },
    messageIds.length
      ? prisma.stagedMessage.updateMany({
          where: { id: { in: messageIds }, sentAt: null },
          data: { turnId: openTurn.id, deliveryFailures: null },
        })
      : { count: 0 },
  ]);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "staging_retargeted",
      details: { toTurnNumber: openTurn.number, effects: effects.count, messages: messages.count },
    },
  });

  return {
    effects: effects.count,
    messages: messages.count,
    // The retargeted rows flip `missed` on their DTO, which is what clears the
    // banner — so the patch names every id that was offered, not just the ones
    // that moved.
    patch: await deskPatchFor({ stagedEffectIds: effectIds, stagedMessageIds: messageIds }),
  };
}

async function lockHolderName(discordUserId) {
  if (!discordUserId) return "Another GM";
  const members = await listGuildMembers().catch(() => []);
  return members.find((m) => m.id === discordUserId)?.username ?? "Another GM";
}

// One conditional write: nobody holds it, I already hold it, or the TTL lapsed.
async function claimMoveLockImpl({ actionId }) {
  const session = await requireGm();

  const { count } = await prisma.action.updateMany({
    where: {
      id: actionId ?? "",
      OR: [
        { lockedByDiscordUserId: null },
        { lockedByDiscordUserId: session.discordUserId },
        { lockExpiresAt: null },
        { lockExpiresAt: { lte: new Date() } },
      ],
    },
    data: {
      lockedByDiscordUserId: session.discordUserId,
      lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS),
    },
  });

  if (!count) {
    const action = await prisma.action.findUnique({ where: { id: actionId ?? "" } });
    if (!action) throw new UserError("Move not found.");
    const holder = await lockHolderName(action.lockedByDiscordUserId);
    throw new UserError(`${holder} is adjudicating this Move.`);
  }

  // The lock is presence, and presence is a row field (lockedByDiscordUserId
  // on the Move DTO) — so it folds into the desk store like any other change.
  return { ttlMs: MOVE_LOCK_TTL_MS, patch: await deskPatchFor({ moveIds: [actionId] }) };
}

async function refreshMoveLockImpl({ actionId }) {
  const session = await requireGm();
  const { count } = await prisma.action.updateMany({
    where: { id: actionId ?? "", lockedByDiscordUserId: session.discordUserId },
    data: { lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS) },
  });
  if (!count) throw new UserError("Your hold on this Move expired.");
  return {};
}

async function releaseMoveLockImpl({ actionId }) {
  const session = await requireGm();
  await prisma.action.updateMany({
    where: { id: actionId ?? "", lockedByDiscordUserId: session.discordUserId },
    data: { lockedByDiscordUserId: null, lockExpiresAt: null },
  });
  return { patch: await deskPatchFor({ moveIds: [actionId] }) };
}

// A Gambit carries a die and a Routine never does, so switching kind rewrites
// the dice rather than leaving a stale number.
//
// Takes `tx` and is async because the die is not this function's to invent:
// ensureGambitDie owns every throw, and flipping a Gambit to Routine and back
// must hand the character THE SAME die rather than a new one. That closes a
// GM-side re-roll loop the old design left open — the comment below already
// claimed to roll "the same die the player's own submit path would have", and
// now it does. It also means Inspired is spent by the helper, inside this same
// transaction, so the caller owes no consume.
async function normalizeEdits(tx, action, edits, characterTags, mood) {
  const data = {};

  const kind = ["GAMBIT", "ROUTINE"].includes(edits.moveKind) ? edits.moveKind : action.moveKind;
  // A Mine is paid at the press and arrives here with appliedEffects stamped
  // (web/app/(app)/character/actions/mine.js). Flipping it to something else has to hand the
  // payout back, or the ⬢, the drop and the Tired all stay banked while the staged push goes
  // on skipping the row for being already-applied — and the GM adjudicates a Gambit on top of
  // a day's wages. Reject already reverts through deleteActionRestoringTurn; the kind flip
  // did not. Keyed on appliedEffects rather than on a kind, because "already paid" is the
  // fact that matters and every such row is a ROUTINE now.
  let revertPayout = false;
  if (kind !== action.moveKind) {
    data.moveKind = kind;
    if (action.appliedEffects) {
      revertPayout = true;
      data.appliedEffects = null;
      data.resourceRollValue = null;
      data.resourceDelta = null;
    }
    if (kind === "ROUTINE") {
      data.diceRoll = null;
      data.diceModifier = null;
    } else {
      // The character's die for this turn — theirs if they already threw one, a
      // new one if this is the first Gambit they have carried today. Flipping to
      // ROUTINE above nulls the columns but leaves the GambitDie row standing,
      // which is exactly what makes flipping back give the number back.
      const gambit = await ensureGambitDie(tx, { turnId: action.turnId, character: { id: action.characterId, tags: characterTags } });
      data.diceRoll = gambit.die;
      // The modifier IS recomputed from the character's state right now, not
      // carried — it is a reading of how they are, and unlike the die there is
      // nothing random in it to fish for.
      data.diceModifier = gambitModifierTotal(characterTags, { mood });
    }
  }

  data.resultMessage = edits.resultMessage?.toString().trim() || null;
  return { data, revertPayout };
}

// mode: "save" keeps edits and leaves it open; "solve" marks SOLVED (nothing
// applies until the push); "unsolve" goes back to OPEN.
async function resolveMoveImpl({ actionId, mode, edits = {} }) {
  const session = await requireGm();
  if (!["save", "solve", "unsolve"].includes(mode)) throw new UserError("Unknown mode.");

  const action = await prisma.action.findUnique({
    where: { id: actionId ?? "" },
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
  if (!action) throw new UserError("Move not found.");
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError(`${await lockHolderName(action.lockedByDiscordUserId)} is adjudicating this Move.`);
  }

  // Check and transition in one statement, stopping two GMs from silently
  // overwriting each other's verdicts.
  const result = await prisma.$transaction(async (tx) => {
    // Every branch renews the lock rather than clearing it — release happens
    // separately (unmount, pagehide beacon, or TTL lapse in moveEconomy.js).
    const renewedLock = { lockedByDiscordUserId: session.discordUserId, lockExpiresAt: new Date(Date.now() + MOVE_LOCK_TTL_MS) };

    if (mode === "unsolve") {
      const claimed = await tx.action.updateMany({
        where: { id: actionId ?? "", moveReviewStatus: "SOLVED" },
        data: {
          moveReviewStatus: "OPEN",
          reviewedAt: null,
          reviewedByDiscordUserId: null,
          ...renewedLock,
        },
      });
      if (!claimed.count) throw new UserError("That Move isn't solved.");
      return { status: "OPEN", note: "Reopened." };
    }

    const { data, revertPayout } = await normalizeEdits(
      tx,
      action,
      edits,
      action.character.tags,
      action.character.mood,
    );
    // Before the update below clears appliedEffects: revertMoveEffects reads it off the row
    // it is handed, so it has to see the payout it is undoing.
    if (revertPayout) await revertMoveEffects(tx, action);

    if (mode === "save") {
      // Save keeps the edits and leaves status wherever it was.
      await tx.action.update({
        where: { id: actionId },
        data: { ...data, ...renewedLock },
      });
      return { status: action.moveReviewStatus, note: "Saved." };
    }

    // Solve: nothing applies now, it lands at the push. Conditional claim
    // stops two GMs racing from a stale view.
    const claimed = await tx.action.updateMany({
      where: { id: actionId ?? "", moveReviewStatus: { not: "SOLVED" } },
      data: { moveReviewStatus: "SOLVED" },
    });
    if (!claimed.count) {
      const fresh = await tx.action.findUnique({ where: { id: actionId } });
      if (fresh?.reviewedByDiscordUserId === session.discordUserId) {
        throw new UserError("You already solved this Move — it's marked and will push.");
      }
      throw new UserError(`${await lockHolderName(fresh?.reviewedByDiscordUserId)} already solved this Move.`);
    }

    await tx.action.update({
      where: { id: actionId },
      data: {
        ...data,
        reviewedAt: new Date(),
        reviewedByDiscordUserId: session.discordUserId,
        ...renewedLock,
      },
    });
    return { status: "SOLVED", note: "Staged for the push." };
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: `move_${mode}`,
      targetCharacterId: action.characterId,
      details: { actionId, note: result.note },
    },
  });

  return { ...result, patch: await deskPatchFor({ moveIds: [actionId] }) };
}

// The Caving desk's two buttons, same shape as resolveMoveImpl above.
// mode: "save" keeps the Result text and leaves the roll wherever it was;
// "resolve" is the one-way stamp on a TROUBLE roll (no unsolve), idempotent
// for a QUIET/FIND row that was already resolved at creation.
//
// Save exists because the Result box stayed editable on a resolved roll while
// the only button that persisted it disappeared, so anything typed after
// resolving was quietly thrown away — the same trap MoveDesk.js:415 describes.
async function resolveCavingRollImpl({ cavingRollId, gmNotes: rawNotes, mode = "resolve" }) {
  const session = await requireGm();
  if (!["save", "resolve"].includes(mode)) throw new UserError("Unknown mode.");

  const roll = await prisma.cavingRoll.findUnique({ where: { id: cavingRollId ?? "" } });
  if (!roll) throw new UserError("Caving roll not found.");

  const gmNotes = rawNotes?.toString().trim() || null;

  // A save touches the text and nothing else: it must not resolve an open roll,
  // and must not re-stamp somebody else as the GM who resolved it.
  const data =
    mode === "save"
      ? { gmNotes }
      : { gmNotes, resolvedAt: roll.resolvedAt ?? new Date(), resolvedByDiscordUserId: session.discordUserId };

  await prisma.cavingRoll.update({ where: { id: roll.id }, data });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: mode === "save" ? "caving_roll_saved" : "caving_roll_resolved",
      targetCharacterId: roll.characterId,
      details: { cavingRollId: roll.id, die: roll.die, kind: roll.kind },
    },
  });

  const patch = await deskPatchFor({ cavingRollIds: [roll.id] });
  if (mode === "save") return { status: roll.resolvedAt ? "RESOLVED" : "OPEN", note: "Saved.", patch };
  return { status: "RESOLVED", patch };
}

// "Reject" on the desk. Deletes the Action outright, since the turn-economy
// checks look for any Action on the open turn — only deletion frees the
// player to act again. Staged rows detach via SetNull.
async function rejectMoveImpl({ actionId }) {
  const session = await requireGm();

  const action = await prisma.action.findUnique({ where: { id: actionId }, include: { character: true } });
  if (!action) throw new UserError("Move not found.");
  if (lockIsLive(action) && action.lockedByDiscordUserId !== session.discordUserId) {
    throw new UserError(`${await lockHolderName(action.lockedByDiscordUserId)} is adjudicating this Move.`);
  }

  // Read before the delete: the staged rows hanging off this Move survive it,
  // detached (moveId SetNull), and the desk has to be told they moved to the
  // tray rather than left showing them under a Move that is gone.
  const [detachedEffects, detachedMessages] = await Promise.all([
    prisma.stagedEffect.findMany({ where: { moveId: action.id }, select: { id: true } }),
    prisma.stagedMessage.findMany({ where: { moveId: action.id }, select: { id: true } }),
  ]);

  // A lesson's partner Moves may go with this one (db/lib/lessons.js); the
  // learners it strands are told after commit.
  let lessonDms = [];
  await prisma.$transaction(async (tx) => {
    lessonDms = await deleteActionRestoringTurn(tx, action);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "move_rejected",
        targetCharacterId: action.characterId,
        details: {
          actionId,
          description: action.description,
          moveKind: action.moveKind,
          appliedEffects: action.appliedEffects ?? null,
        },
      },
    });
  for (const dm of lessonDms) {
    after(() => sendDm(dm.discordUserId, dm.content).catch((err) => console.error("Lesson cancel DM failed:", err)));
  }
  });

  // Sent directly, not deferred to the push — a freed turn the player
  // doesn't know about is a wasted day.
  let deliveryFailed = false;
  try {
    await sendDm(
      action.character.discordUserId,
      "Your Move was returned to you — you can act again this turn.",
      // Canned all the way through now that Reject carries no typed reason,
      // but it is still a GM handing somebody their turn back, so it belongs
      // in the conversation rather than sinking into the notices.
      { authorDiscordUserId: session.discordUserId, source: "move_unlock", kind: DM_KIND.CONVERSATION },
    );
  } catch (err) {
    console.error(`Failed to DM the rejection to ${action.character.discordUserId}:`, err);
    deliveryFailed = true;
  }

  revalidatePath("/character");
  return {
    description: action.description,
    deliveryFailed,
    patch: await deskPatchFor({
      stagedEffectIds: detachedEffects.map((e) => e.id),
      stagedMessageIds: detachedMessages.map((m) => m.id),
      removed: { moveIds: [action.id] },
    }),
  };
}

async function getCharacterInspectorImpl({ characterId }) {
  await requireGm();
  const character = await prisma.character.findUnique({
    where: { id: characterId ?? "" },
    include: {
      zone: { select: { name: true } },
      location: { select: { name: true } },
      tags: {
        select: {
          tagId: true,
          quantity: true,
          expiresTurn: true,
          equipped: true,
          // "2 of 5 worn" — the one fact a compact row can never carry, and
          // what web/lib/sheetCards.js#itemFacts counts a partly-equipped
          // stack by (SHEET.md). Nothing read it on the desk until the
          // inspector's Tags tab started drawing the sheet's own cards.
          equippedQuantity: true,
          // chipSelect() alone draws a CHIP. The inspector's Tags tab draws
          // the sheet's ROWS now, and sheetCards.js reads four columns a chip
          // never needed: without them every item row loses its verbs mark,
          // its stack, and the carry/mining value on its right.
          tag: {
            select: chipSelect({ equippable: true, stackable: true, carryBonus: true, miningBonus: true, gambitBonus: true }),
          },
        },
      },
    },
  });
  if (!character) throw new UserError("Character not found.");

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const acted = openTurn
    ? Boolean(await prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id }, select: { id: true } }))
    : false;

  return {
    id: character.id,
    name: character.name,
    status: character.status,
    discordUserId: character.discordUserId,
    roleTitle: character.roleTitle ?? null,
    isLeader: character.isLeader,
    // Zone · Location, because Character.locationId is where a ruling
    // actually happens — a placed structure, a stash, a fight are all
    // Location-grain facts (MAP.md §1). Same shape moveRows.js now carries.
    locationLabel: character.location?.name
      ? `${character.zone?.name ?? "?"} · ${character.location.name}`
      : character.zone?.name || "Unassigned",
    // The whole tag set is loaded above with `tag.slug`, so the ⬢ stack is
    // already in hand — no second query for a balance.
    resources: resourcesOf(character),
    tagPoints: character.tagPoints,
    gambitModifier: gambitModifierTotal(character.tags, { mood: character.mood }),
    acted,
    currentTurnNumber: openTurn?.number ?? null,
    tags: character.tags.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      expiresTurn: ct.expiresTurn,
      equipped: ct.equipped,
      equippedQuantity: ct.equippedQuantity,
      // InspectorColumn.js prefers this row over its tagsById fallback, and
      // /gm/players and /gm/oracle pass no fallback at all — so an uncomposed
      // row here is a blank paper hover on all three desks.
      tag: composeChipTag(ct.tag, GM_CHIP_CTX),
    })),
  };
}

// The Inspector's DMs tab uses web/app/(app)/gm/messages/actions.js
// #getDmThreadPage and #sendGmDm directly, the same path /gm/messages uses.

const CONTEXT_SLICE = 30;

// The scene around one archived line: ~30 messages before/after in the same
// Discord channel/thread.
async function getArchiveContextImpl({ archiveEntryId }) {
  await requireGm();
  const anchor = await prisma.archiveEntry.findUnique({ where: { id: archiveEntryId ?? "" } });
  if (!anchor) throw new UserError("That transcript row is gone.");

  // Two ways to identify "the same channel": the snapshot column, and the
  // legacy zoneId/channelKind/threadName triple for pre-backfill rows.
  const identity = [];
  if (anchor.discordChannelId) identity.push({ discordChannelId: anchor.discordChannelId });
  if (anchor.zoneId != null || anchor.channelKind != null) {
    identity.push({ zoneId: anchor.zoneId, channelKind: anchor.channelKind, threadName: anchor.threadName });
  }
  if (!identity.length) throw new UserError("That row carries no channel identity.");

  const channelWhere = { kind: "MESSAGE", OR: identity };

  const [before, after] = await Promise.all([
    prisma.archiveEntry.findMany({
      where: {
        AND: [
          channelWhere,
          { OR: [{ sentAt: { lt: anchor.sentAt } }, { sentAt: anchor.sentAt, id: { lt: anchor.id } }] },
        ],
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: CONTEXT_SLICE,
    }),
    prisma.archiveEntry.findMany({
      where: {
        AND: [
          channelWhere,
          { OR: [{ sentAt: { gt: anchor.sentAt } }, { sentAt: anchor.sentAt, id: { gt: anchor.id } }] },
        ],
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      take: CONTEXT_SLICE,
    }),
  ]);

  // Server-only env, so the URL is built here, never client-side.
  const guildId = process.env.DISCORD_GUILD_ID || null;
  const channelLabel =
    [anchor.zoneName, anchor.threadName].filter(Boolean).join(" · ") || anchor.channelKind || "unknown channel";
  const jumpUrl =
    guildId && anchor.discordChannelId && anchor.discordMessageId
      ? `https://discord.com/channels/${guildId}/${anchor.discordChannelId}/${anchor.discordMessageId}`
      : null;

  const entries = [...before.reverse(), anchor, ...after].map((e) => ({
    id: e.id,
    content: e.content,
    characterName: e.characterName,
    concealedAlias: e.concealedAlias,
    turnNumber: e.turnNumber,
    sentAt: e.sentAt.toISOString(),
  }));

  return { anchorId: anchor.id, channelLabel, jumpUrl, entries };
}

// The History lens, one resolved turn at a time, loaded on demand so the
// open turn's desk and its 45s router.refresh() never pay for it. Uses the
// same mappers as page.js (web/lib/moveRows.js).
async function getMoveHistoryImpl({ turnId }) {
  await requireGm();
  const id = turnId?.toString().trim() ?? "";
  if (!id) throw new UserError("No turn specified.");

  const turn = await prisma.turn.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!turn) throw new UserError("That turn no longer exists.");
  if (turn.status !== "RESOLVED") throw new UserError("That turn hasn't been pushed yet.");

  const [actions, cavingRolls, members, stagingLocations, openTurn] = await Promise.all([
    prisma.action.findMany({ where: { turnId: id }, orderBy: { createdAt: "desc" }, include: MOVE_INCLUDE }),
    prisma.cavingRoll.findMany({ where: { turnId: id }, orderBy: { createdAt: "desc" }, include: CAVING_ROLL_INCLUDE }),
    listGuildMembers(),
    prisma.location.findMany({
      orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } }),
  ]);

  const moveIds = actions.map((a) => a.id);
  const cavingIds = cavingRolls.map((c) => c.id);
  // Staged rows attach to either a Move or a Caving roll.
  const [stagedEffects, stagedMessages] =
    moveIds.length || cavingIds.length
      ? await Promise.all([
          prisma.stagedEffect.findMany({
            where: { OR: [{ moveId: { in: moveIds } }, { cavingRollId: { in: cavingIds } }] },
            orderBy: { createdAt: "asc" },
            include: STAGED_EFFECT_INCLUDE,
          }),
          prisma.stagedMessage.findMany({
            where: { OR: [{ moveId: { in: moveIds } }, { cavingRollId: { in: cavingIds } }] },
            orderBy: { createdAt: "asc" },
            include: STAGED_MESSAGE_INCLUDE,
          }),
        ])
      : [[], []];

  const usernameById = new Map(members.map((m) => [m.id, m.username]));
  const locationNameById = new Map(stagingLocations.map((l) => [l.id, l.name]));
  const now = new Date();

  return {
    // structuresByLocationId is deliberately not passed: this lens shows a
    // PAST turn, and today's ground under a months-old Move would lie. The
    // history desk renders no Standing-here line, so nothing is missing it.
    moves: actions.map((a) => moveRow(a, { usernameById, now })),
    cavingRolls: cavingRolls.map((c) => cavingRollRow(c, { usernameById, catatonicIds: new Set() })),
    effects: stagedEffects.map((e) => stagedEffectRow(e, { usernameById, locationNameById, openTurn })),
    messages: stagedMessages.map((m) => stagedMessageRow(m, { usernameById, openTurn })),
    tagsById: tagsByIdFor(actions),
  };
}

// The inspector's Moves tab: one character, past turns only (the player
// desk's Canon tab owns the open one). Newest first, capped, with each
// Move's sent private messages.
const MOVE_HISTORY_LIMIT = 40;
const MOVE_HISTORY_PREVIEW_CHARS = 140;

async function getCharacterMoveHistoryImpl({ characterId }) {
  await requireGm();
  const id = characterId?.toString().trim() ?? "";
  if (!id) throw new UserError("No character specified.");

  const actions = await prisma.action.findMany({
    // Confirmed only — a PENDING_TYPE row is an abandoned draft.
    where: {
      characterId: id,
      status: { in: ["CONFIRMED", "ADJUDICATED"] },
      turn: { status: "RESOLVED" },
    },
    orderBy: [{ turn: { number: "desc" } }, { createdAt: "desc" }],
    take: MOVE_HISTORY_LIMIT,
    include: {
      turn: { select: { number: true, dayNumber: true } },
      stagedMessages: {
        where: { kind: "PRIVATE", sentAt: { not: null } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          content: true,
          recipients: { select: { character: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  // guarded() spreads the payload, so a bare array would come back as indices.
  return {
    rows: actions.map((a) => ({
      id: a.id,
      turnLabel: a.turn ? `${a.turn.number} · Day ${a.turn.dayNumber}` : "—",
      kindLabel: moveKindLabel(a.moveKind, a.gmNotes),
      reviewLabel: MOVE_REVIEW_LABELS[a.moveReviewStatus] ?? "Open",
      rollLabel: rollLabel(a),
      declaredLabel: declaredLabel(a),
      paidLabel: paidLabel(a.appliedEffects),
      description: a.description ?? "",
      resultMessage: truncateHistoryText(a.resultMessage),
      messages: a.stagedMessages.map((m) => ({
        id: m.id,
        content: truncateHistoryText(m.content),
        recipientNames: m.recipients.map((r) => r.character.name),
      })),
    })),
  };
}

function truncateHistoryText(text) {
  const clean = (text ?? "").trim();
  return clean.length > MOVE_HISTORY_PREVIEW_CHARS
    ? `${clean.slice(0, MOVE_HISTORY_PREVIEW_CHARS - 1)}…`
    : clean;
}

// The composer's held-tags panel: lean rows for one character, keyed by tag.
async function getHeldTagsImpl({ characterId }) {
  await requireGm();
  const rows = await prisma.characterTag.findMany({
    where: { characterId: characterId ?? "" },
    select: { tagId: true, quantity: true, tag: { select: { name: true, stackable: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return { tags: rows.map((r) => ({ tagId: r.tagId, name: r.tag.name, quantity: r.quantity, stackable: r.tag.stackable })) };
}

// The same panel for a room: what is lying on the floor right now, so a GM
// staging a Remove is choosing from what is actually there. A room has no
// sheet, so this stands in for getHeldTags.
async function getRoomStashImpl({ roomId }) {
  await requireGm();
  const room = await prisma.room.findUnique({
    where: { id: roomId ?? "" },
    select: {
      tags: {
        where: { quantity: { gt: 0 } },
        select: { tagId: true, quantity: true, tag: { select: { slug: true, name: true, stackable: true } } },
        orderBy: { tag: { name: "asc" } },
      },
    },
  });
  if (!room) throw new UserError("That room no longer exists.");
  return {
    resources: resourcesOf(room),
    // ⬢ are a stack row now, so they come back out of the tag list: the
    // composer already draws them on their own line above it, and staging
    // them as a tag op would be a second, unledgered way to move money.
    tags: withoutResources(room.tags)
      .map((r) => ({ tagId: r.tagId, name: r.tag.name, quantity: r.quantity, stackable: r.tag.stackable })),
  };
}

export async function createStagedMessage(input) {
  return guarded(() => createStagedMessageImpl(input));
}
export async function updateStagedMessage(input) {
  return guarded(() => updateStagedMessageImpl(input));
}
export async function deleteStagedMessage(input) {
  return guarded(() => deleteStagedMessageImpl(input));
}
export async function resendStagedMessage(input) {
  return guarded(() => resendStagedMessageImpl(input));
}
export async function sendDecree(input) {
  return guarded(() => sendDecreeImpl(input));
}
export async function createStagedEffects(input) {
  return guarded(() => createStagedEffectsImpl(input));
}
export async function createStagedDeaths(input) {
  return guarded(() => createStagedDeathsImpl(input));
}
export async function updateStagedDeath(input) {
  return guarded(() => updateStagedDeathImpl(input));
}
export async function createStagedTransfer(input) {
  return guarded(() => createStagedTransferImpl(input));
}
export async function createStagedRoomEffect(input) {
  return guarded(() => createStagedRoomEffectImpl(input));
}
export async function updateStagedRoomEffect(input) {
  return guarded(() => updateStagedRoomEffectImpl(input));
}
export async function updateStagedEffect(input) {
  return guarded(() => updateStagedEffectImpl(input));
}
export async function deleteStagedEffect(input) {
  return guarded(() => deleteStagedEffectImpl(input));
}
export async function retargetMissedStaging(input) {
  return guarded(() => retargetMissedStagingImpl(input));
}
export async function claimMoveLock(input) {
  return guarded(() => claimMoveLockImpl(input));
}
export async function refreshMoveLock(input) {
  return guarded(() => refreshMoveLockImpl(input));
}
export async function releaseMoveLock(input) {
  return guarded(() => releaseMoveLockImpl(input));
}
export async function resolveMove(input) {
  return guarded(() => resolveMoveImpl(input));
}
export async function rejectMove(input) {
  return guarded(() => rejectMoveImpl(input));
}
// Taking a Caving find back off the sheet. The roll itself stands — a GM is
// undoing the loot, not the die. lootUndoneAt is the claim: the update only
// matches while it is still null, so two clicks drop one tag (CAVING.md §4).
async function undoCavingFindImpl({ rollId }) {
  const session = await requireGm();
  const roll = await prisma.cavingRoll.findUnique({
    where: { id: rollId ?? "" },
    include: { lootTag: { select: { name: true } } },
  });
  if (!roll) throw new UserError("That roll is gone.");
  if (!roll.lootTagId) throw new UserError("That roll found nothing.");
  if (roll.lootUndoneAt) throw new UserError("That find has already been taken back.");

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.cavingRoll.updateMany({
      where: { id: roll.id, lootUndoneAt: null },
      data: { lootUndoneAt: new Date() },
    });
    if (claimed.count === 0) throw new UserError("That find has already been taken back.");
    await dropCharacterTag(tx, roll.characterId, roll.lootTagId, 1);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "caving_loot_undone",
        targetCharacterId: roll.characterId,
        turnId: roll.turnId,
        details: { rollId: roll.id, tagId: roll.lootTagId, tagName: roll.lootTag?.name ?? null },
      },
    });
  });

  await afterInventoryChange(roll.characterId);
  return { ok: true, patch: await deskPatchFor({ cavingRollIds: [roll.id] }) };
}

// ─── The uploaded-portrait queue (docs/systemdocs/PORTRAITS.md §1a) ─────────
//
// The Browse control tells players "Your image may be approved or denied."
// These two are what stands behind that sentence. The picture
// is live from the moment it is saved — Keep and Reject decide whether it
// stays, they do not gate it.
//
// requireGm() first in both: the id below is posted by a client, and a server
// action is a public endpoint.

// Looked at, and fine. Nothing about the game changes, so nothing is written
// to the audit log — /gm/audit is the record of what was DONE to the game, and
// filling it with "a GM looked at a picture" would cost the log its signal.
async function keepAvatarImpl({ characterId }) {
  await requireGm();
  const character = await prisma.character.findUnique({
    where: { id: String(characterId ?? "") },
    select: { id: true, name: true, avatarData: true, portrait: true },
  });
  if (!character) throw new UserError("That character is gone.");
  // Another GM got here first and rejected it. Say so rather than stamping a
  // review onto a picture that is no longer there.
  if (!character.avatarData || character.portrait) {
    throw new UserError("That picture is already gone.");
  }

  await prisma.character.update({
    where: { id: character.id },
    data: { avatarReviewedAt: new Date() },
  });

  return { name: character.name };
}

// Not fine. Clears the picture exactly as the player's own Reset to Default
// does — there is nothing to restore, because the letter plaque is derived
// from firstName at read time by /api/avatar/[characterId].
//
// `updatedAt` bumps on its own, which is what retires the immutably-cached
// image URL every surface is holding.
async function rejectAvatarImpl({ characterId }) {
  const session = await requireGm();
  const character = await prisma.character.findUnique({
    where: { id: String(characterId ?? "") },
    select: { id: true, name: true, discordUserId: true, status: true, avatarData: true, portrait: true },
  });
  if (!character) throw new UserError("That character is gone.");
  if (!character.avatarData || character.portrait) {
    throw new UserError("That picture is already gone.");
  }

  await prisma.character.update({
    where: { id: character.id },
    data: {
      avatarData: null,
      avatarMimeType: null,
      portrait: null,
      avatarSetAt: null,
      avatarReviewedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_avatar_rejected",
      targetCharacterId: character.id,
      details: { characterName: character.name },
    },
  });

  // The third thing a queue needs, after the surface and the state: telling
  // them. A NOTICE rather than a CONVERSATION — the wording is canned, and a
  // canned line sitting at the top of the GM inbox as mail is the exact
  // pattern DM_KIND was built to stop. A GM who wants to talk about it writes.
  if (character.discordUserId && character.status === "ALIVE") {
    await sendDm(
      character.discordUserId,
      "Your portrait wasn't approved.",
      { kind: DM_KIND.NOTICE },
    ).catch((err) => console.error("Avatar rejection DM failed:", err));
  }

  revalidatePath("/character");
  return { name: character.name };
}


// ─── The Desires review queue (docs/systemdocs/DESIRES.md §6) ─────────────
//
// A claim pays its points the instant a player types a reason and submits —
// Keep and Reject decide whether the claim STANDS, they do not gate it. Same
// posture as keepAvatarImpl/rejectAvatarImpl just above, and Reject is the
// desk's own copy of the Dev Panel's revokeDesireGmImpl
// (web/app/(app)/gm/dev/characters/[characterId]/actions.js) — same row
// lock, same core, so there is exactly one way a claimed Desire ever comes
// back off.

// Idempotent by construction: the updateMany only flips a row still waiting
// (reviewedAt null), so a second press — another GM, or a double-click —
// finds nothing left to claim and simply reports it, rather than throwing.
async function keepDesireClaimImpl({ desireId }) {
  const session = await requireGm();
  const { count } = await prisma.desire.updateMany({
    where: { id: String(desireId ?? ""), reviewedAt: null },
    data: { reviewedAt: new Date(), reviewedBy: session.discordUserId },
  });
  return { ok: true, kept: count > 0 };
}

async function rejectDesireClaimImpl({ desireId }) {
  const session = await requireGm();
  const id = String(desireId ?? "");
  const desire = await prisma.desire.findUnique({
    where: { id },
    include: { character: { select: { id: true, name: true, discordUserId: true, status: true } } },
  });
  if (!desire) throw new UserError("That claim is gone.");
  if (desire.reviewedAt) throw new UserError("That claim was already reviewed.");

  await prisma.$transaction(async (tx) => {
    // Same row lock revokeDesireGmImpl takes, so a Reject here and a Dev
    // Panel revoke of the same row can't both take the points back.
    await tx.$queryRaw`SELECT "id" FROM "Character" WHERE "id" = ${desire.characterId} FOR UPDATE`;
    try {
      await revokeDesireCore(tx, { characterId: desire.characterId, desireId: id, desire });
    } catch (e) {
      // db/lib takes no dependency on web/lib/actionResult, so its deliberate
      // refusal arrives as a DesireRevokeRefused and is recast here. Only
      // that one — anything else rethrows untouched and stays redacted,
      // rather than being shown to a GM as a rule (mirrors
      // gm/dev/.../actions.js#revokeDesireGmImpl).
      if (e instanceof DesireRevokeRefused) throw new UserError(e.message);
      throw e;
    }
    await tx.desire.update({
      where: { id },
      data: { reviewedAt: new Date(), reviewedBy: session.discordUserId },
    });
  });

  // Same actionType the Dev Panel's revoke writes, so /gm/audit reads both
  // the same rather than growing a second word for one event.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_desire_cancelled",
      targetCharacterId: desire.characterId,
      details: { desireId: id, desireName: desire.text, claimText: desire.reason, points: desire.points },
    },
  });

  // A NOTICE, not a CONVERSATION — the game said it, and a canned line
  // sitting at the top of the GM inbox as mail is the exact pattern DM_KIND
  // was built to stop (see rejectAvatarImpl above for the identical call).
  if (desire.character.discordUserId && desire.character.status === "ALIVE") {
    await sendDm(desire.character.discordUserId, "Your desire was rejected.", {
      kind: DM_KIND.NOTICE,
    }).catch((err) => console.error("Desire rejection DM failed:", err));
  }

  revalidatePath("/character");
  return { name: desire.character.name };
}

// A read-only slice of one character's audit trail, for the Desire desk's
// verify-it-yourself filter (DESIRES.md §6, DesireDesk.js). `query` narrows
// to rows whose `details` blob mentions it, the same ILIKE
// AuditLog_details_trgm_idx exists to serve (web/lib/auditQuery.js#detailsMatchIds)
// — not a second index, the same one.
const CHARACTER_AUDIT_SLICE_LIMIT = 40;

async function getCharacterAuditSliceImpl({ characterId, query }) {
  await requireGm();
  const id = String(characterId ?? "");
  if (!id) throw new UserError("No character given.");
  const q = (query ?? "").toString().trim();

  let idFilter = null;
  if (q) {
    const matched = await prisma.$queryRaw`
      SELECT "id" FROM "AuditLog"
      WHERE "targetCharacterId" = ${id} AND "details"::text ILIKE ${`%${q}%`}
      ORDER BY "createdAt" DESC
      LIMIT ${CHARACTER_AUDIT_SLICE_LIMIT}
    `;
    idFilter = matched.map((r) => r.id);
    if (!idFilter.length) return { rows: [] };
  }

  const [rows, gmProfiles, guildMembers, turns] = await Promise.all([
    prisma.auditLog.findMany({
      where: idFilter ? { id: { in: idFilter } } : { targetCharacterId: id },
      orderBy: { createdAt: "desc" },
      take: CHARACTER_AUDIT_SLICE_LIMIT,
      include: {
        targetCharacter: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
      },
    }),
    getGmProfiles(),
    listGuildMembers(),
    prisma.turn.findMany({ select: { number: true, dayNumber: true, startedAt: true }, orderBy: { startedAt: "asc" } }),
  ]);

  // Same DTO shape /gm/audit's own page.js builds (toDto), trimmed to what
  // describeAudit/AuditSegments actually read — this panel reuses their
  // rendering, not their whole query surface.
  const usernameById = new Map(guildMembers.map((m) => [m.id, m.globalName ?? m.username ?? m.id]));
  const gmIdSet = new Set(gmProfiles.map((p) => p.discordUserId));

  return {
    rows: rows.map((row) => {
      const turn = turnAt(turns, row.createdAt);
      const isSystem = row.actorDiscordUserId === "system";
      return {
        id: row.id,
        actionType: row.actionType,
        createdAt: row.createdAt.toISOString(),
        reason: row.reason ?? null,
        details: row.details ?? null,
        actor: {
          discordUserId: row.actorDiscordUserId,
          name: isSystem ? "The turn engine" : (usernameById.get(row.actorDiscordUserId) ?? row.actorDiscordUserId),
          kind: isSystem ? "system" : gmIdSet.has(row.actorDiscordUserId) ? "gm" : "player",
          characterId: null,
          characterName: null,
        },
        target: row.targetCharacter ? { id: row.targetCharacter.id, name: row.targetCharacter.name } : null,
        location: row.location ? { id: row.location.id, name: row.location.name } : null,
        room: row.room ? { id: row.room.id, name: row.room.name } : null,
        turnNumber: turn?.number ?? null,
        dayNumber: turn?.dayNumber ?? null,
      };
    }),
  };
}

// CALLING A FIGHT OFF FROM THE DESK (docs/systemdocs/ATTACK.md §7).
//
// Only the attacker can break off, which leaves a GM reading the Other lens
// with nothing to press when a fight needs ending. This is that button, and
// it ends ONE pairing: cancelAttack's WHERE names two people and a turn, and
// a cluster-wide version would end fights the GM never meant to touch.
const HOLD_CALLED_OFF_DM = "The attack was canceled.";

async function cancelHoldAsGmImpl({ attackId }) {
  // The id below is posted by a client, and a server action is a public
  // endpoint — so the gate is here, not on the row that drew the button.
  const session = await requireGm();
  const openTurn = await requireOpenTurn();

  const attack = await prisma.attack.findUnique({
    where: { id: String(attackId ?? "") },
    select: {
      id: true,
      turnId: true,
      cancelledAt: true,
      attacker: { select: { id: true, name: true, discordUserId: true, status: true } },
      targetCharacter: { select: { id: true, name: true, discordUserId: true, status: true } },
    },
  });
  if (!attack) throw new UserError("That fight is gone.");
  if (attack.cancelledAt) throw new UserError("That fight is already off.");
  // A fight on a turn the push already swept is nobody's to end: the turn
  // advance freed both of them for free (ATTACK.md §1).
  if (attack.turnId !== openTurn.id) throw new UserError("That fight was on an earlier turn.");

  // Never stamp cancelledAt by hand. cancelAttack also settles BOTH sides,
  // which RE-POINTS heldById rather than blindly clearing it — a blind clear
  // frees somebody out of a fight that is still going (ATTACK.md §2).
  const done = await cancelAttack(prisma, {
    attackerId: attack.attacker.id,
    targetCharacterId: attack.targetCharacter.id,
    turnId: attack.turnId,
  });
  if (!done.ok) throw new UserError("That fight is already off.");

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_attack_cancelled",
      targetCharacterId: attack.targetCharacter.id,
      turnId: attack.turnId,
      details: { attackerName: attack.attacker.name, targetName: attack.targetCharacter.name },
    },
  });

  // Both sides, because both were held. A NOTICE rather than a CONVERSATION:
  // the game said it, and a canned line sitting at the top of the GM inbox as
  // mail is the exact pattern DM_KIND was built to stop. Each catch()es on its
  // own — a Discord outage must not undo the cancel.
  for (const who of [attack.attacker, attack.targetCharacter]) {
    if (!who.discordUserId || who.status !== "ALIVE") continue;
    after(() =>
      sendDm(who.discordUserId, HOLD_CALLED_OFF_DM, {
        kind: DM_KIND.NOTICE,
        allowedMentions: { parse: [] },
      }).catch(() => {}),
    );
  }

  revalidatePath("/gm/audit");
  revalidatePath("/character");
  return { ok: true };
}

export async function cancelHoldAsGm(input) {
  return guarded(() => cancelHoldAsGmImpl(input ?? {}));
}

export async function resolveCavingRoll(input) {
  return guarded(() => resolveCavingRollImpl(input));
}
export async function undoCavingFind(input) {
  return guarded(() => undoCavingFindImpl(input));
}
export async function getCharacterInspector(input) {
  return guarded(() => getCharacterInspectorImpl(input));
}
export async function getHeldTags(input) {
  return guarded(() => getHeldTagsImpl(input));
}
export async function getRoomStash(input) {
  return guarded(() => getRoomStashImpl(input));
}
export async function getMoveHistory(input) {
  return guarded(() => getMoveHistoryImpl(input));
}
export async function getCharacterMoveHistory(input) {
  return guarded(() => getCharacterMoveHistoryImpl(input));
}
export async function getArchiveContext(input) {
  return guarded(() => getArchiveContextImpl(input));
}

export async function keepAvatar(input) {
  return guarded(() => keepAvatarImpl(input));
}
export async function rejectAvatar(input) {
  return guarded(() => rejectAvatarImpl(input));
}
export async function keepDesireClaim(input) {
  return guarded(() => keepDesireClaimImpl(input));
}
export async function rejectDesireClaim(input) {
  return guarded(() => rejectDesireClaimImpl(input));
}
export async function getCharacterAuditSlice(input) {
  return guarded(() => getCharacterAuditSliceImpl(input));
}

// ---- OOC mutes (db/lib/ooc.js, OocMute) -------------------------------------
//
// A GM stopping one player talking out of character for a while, from the OOC
// lens. It stops `/ooc` and the composer's OOC mode and nothing else: speech
// and shouting belong to the character, and this is about the person.
//
// Keyed on the ACCOUNT, so it follows the player across characters. `until` is
// the whole mechanism — the row lapses on its own, nothing sweeps it.
async function muteOocImpl({ discordUserId, minutes } = {}) {
  const session = await requireGm();
  const account = String(discordUserId ?? "").trim();
  if (!account) throw new UserError("No player to mute.");

  // The label IS the validation: a duration the menu does not offer has no
  // name, and an unnamed duration could not be put in the DM anyway.
  const label = muteDurationLabel(minutes);
  if (!label) throw new UserError("Pick how long.");

  const until = new Date(Date.now() + Number(minutes) * 60_000);
  await prisma.oocMute.upsert({
    where: { discordUserId: account },
    update: { until, byDiscordUserId: session.discordUserId },
    create: { discordUserId: account, until, byDiscordUserId: session.discordUserId },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_ooc_muted",
      details: { discordUserId: account, minutes: Number(minutes), until: until.toISOString() },
    },
  });

  // Told, not left to find out by being refused. Never allowed to fail the
  // mute: the row is already written, and a closed DM is not a reason to
  // pretend it isn't.
  await sendDm(account, `Your OOC was muted for ${label}`).catch((err) =>
    console.error("OOC mute DM failed:", err?.message ?? err),
  );

  return { ok: true, mutedUntil: until.toISOString() };
}

async function unmuteOocImpl({ discordUserId } = {}) {
  const session = await requireGm();
  const account = String(discordUserId ?? "").trim();
  if (!account) throw new UserError("No player to unmute.");

  // deleteMany, not delete: lifting a mute that has already lapsed on its own
  // is the ordinary case, not a missing row to throw about.
  await prisma.oocMute.deleteMany({ where: { discordUserId: account } });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_ooc_unmuted",
      details: { discordUserId: account },
    },
  });
  // No DM. Being told you were muted is the part that needed saying.
  return { ok: true, mutedUntil: null };
}

// Read-back for the desk, so a button that says Unmute is saying something
// true rather than something the page was rendered with.
async function getOocMuteImpl({ discordUserId } = {}) {
  await requireGm();
  const row = await oocMuteFor(prisma, String(discordUserId ?? "").trim());
  return { ok: true, mutedUntil: row ? row.until.toISOString() : null };
}

export async function muteOoc(input) {
  return guarded(() => muteOocImpl(input));
}
export async function unmuteOoc(input) {
  return guarded(() => unmuteOocImpl(input));
}
export async function getOocMute(input) {
  return guarded(() => getOocMuteImpl(input));
}
