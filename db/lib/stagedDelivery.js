// The one code path that delivers a staged message — used by the turn-end
// push (db/lib/turnSideEffects.js) and by the Resend button on /gm/turns. A
// resume used to never retry a bounce, and a resent declaration reached
// Discord and never reached /play. One Delivery row per send, claimed before
// the send and stamped after; the caller stamps the parent StagedMessage.
// Required BY PATH, not off the @lifeweb/db barrel. The MODULE, not a
// destructured `sendDm`: db/test/stagedDelivery.test.js swaps the transport out.
const dm = require("./dm");
const { DM_KIND } = require("./dmKinds");
const { dedupeKey, describeFailure } = require("./dmPolicy");
const discordRest = require("./discordRest"); // the MODULE, same reason as `dm` above.
const { sceneLineAt } = require("./scene");

// FIVE MINUTES, not the thirty Turn.sideEffectClaimedAt uses — that covers a whole side-effect thunk, this covers ONE DM.
const STALE_CLAIM_MS = 5 * 60 * 1000;

// A PRIVATE key names the RECIPIENT, not their Discord account — a character
// who has never linked Discord has a null id, which used to collide every
// such recipient into one row that was never delivered and never even listed
// as failing. A PUBLIC message may have SEVERAL rows, one per channel; the
// summary target's key is the literal word "public" — db/test/stagedDelivery.test.js asserts it stays byte-identical to production's rows.
function deliveryKeyFor(stagedMessageId, recipient = null) {
  const recipientKey = recipient
    ? (recipient.publicKey ?? recipient.characterId ?? recipient.discordUserId ?? null)
    : "public";
  return dedupeKey({ scope: "staged", subjectId: stagedMessageId, recipientKey });
}

// PENDING and FAILED plainly are, plus an IN_FLIGHT row whose claim has gone stale.
function isRetryable(delivery, now = Date.now()) {
  if (delivery.state === "PENDING" || delivery.state === "FAILED") return true;
  if (delivery.state !== "IN_FLIGHT") return false;
  return !delivery.claimedAt || delivery.claimedAt.getTime() < now - STALE_CLAIM_MS;
}

// skipDuplicates on the unique dedupeKey makes this safe on a resumed push: existing rows stay exactly as they are.
async function ensureDeliveries(prisma, { stagedMessage, recipients }) {
  const rows = (recipients?.length ? recipients : [null]).map((r) => ({
    stagedMessageId: stagedMessage.id,
    characterId: r?.characterId ?? null,
    discordUserId: r?.discordUserId ?? null,
    name: r?.name ?? null,
    dedupeKey: deliveryKeyFor(stagedMessage.id, r ?? null),
  }));
  await prisma.delivery.createMany({ data: rows, skipDuplicates: true });
  return prisma.delivery.findMany({
    where: { stagedMessageId: stagedMessage.id },
    orderBy: { createdAt: "asc" },
  });
}

// The guarantee lives in this updateMany's WHERE: a SENT or recently-claimed IN_FLIGHT row matches nothing.
async function claimDelivery(prisma, delivery) {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const claimed = await prisma.delivery.updateMany({
    where: {
      id: delivery.id,
      OR: [
        { state: "PENDING" },
        { state: "FAILED" },
        { state: "IN_FLIGHT", claimedAt: { lt: staleBefore } },
        { state: "IN_FLIGHT", claimedAt: null },
      ],
    },
    data: { state: "IN_FLIGHT", claimedAt: new Date(), attempts: { increment: 1 } },
  });
  return claimed.count === 1;
}

// Returns what happened; the CALLER stamps StagedMessage. `onlyFailed` is
// the Resend button: exactly the ones that bounced, not those merely still pending from a push running right now.
async function deliverPrivate(prisma, { stagedMessage, recipients, onlyFailed = false }) {
  const deliveries = await ensureDeliveries(prisma, { stagedMessage, recipients });
  const byKey = new Map(
    (recipients ?? []).map((r) => [deliveryKeyFor(stagedMessage.id, r), r]),
  );

  const sent = [];
  const failed = [];
  const skipped = [];

  for (const delivery of deliveries) {
    if (delivery.state === "SENT") continue;
    // Resend wants the bounces, including rows a killed push stranded IN_FLIGHT — bounces that never got to say so.
    if (onlyFailed && !(delivery.state === "FAILED" || (delivery.state === "IN_FLIGHT" && isRetryable(delivery))))
      continue;
    const recipient = byKey.get(delivery.dedupeKey) ?? {
      characterId: delivery.characterId,
      name: delivery.name,
      discordUserId: delivery.discordUserId,
    };
    // Somebody else holds it. Not a failure and not a send: reported so the caller's count is honest.
    if (!(await claimDelivery(prisma, delivery))) {
      skipped.push({ characterId: recipient.characterId, name: recipient.name });
      continue;
    }

    let message;
    try {
      message = await dm.sendDm(prisma, recipient.discordUserId, stagedMessage.content, {
        authorDiscordUserId: stagedMessage.createdByDiscordUserId ?? null,
        source: "staged_push",
        kind: DM_KIND.CONVERSATION, // a turn result is GM-authored prose, just delivered in bulk.
      });
    } catch (err) {
      const failure = describeFailure(err);
      await prisma.delivery
        .update({
          where: { id: delivery.id },
          data: { state: "FAILED", claimedAt: null, lastError: failure },
        })
        .catch((markErr) => console.error(`Failed to mark delivery ${delivery.id}:`, markErr));
      failed.push({ characterId: recipient.characterId, name: recipient.name, ...failure });
      continue;
    }

    // THE SEND HAPPENED. Stamping it is a separate try on purpose: a hiccup
    // here must not mark the row FAILED for a DM the player already read. It
    // leaves the row IN_FLIGHT — claimed, so nothing retries it until the stale window expires.
    try {
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          state: "SENT",
          sentAt: new Date(),
          claimedAt: null,
          lastError: null,
          discordMessageId: message?.id ?? null,
        },
      });
    } catch (markErr) {
      console.error(
        `DELIVERY SENT BUT NOT STAMPED — delivery ${delivery.id} (staged message ${stagedMessage.id}) reached ${recipient.name ?? recipient.discordUserId} and the row is still IN_FLIGHT:`,
        markErr,
      );
    }
    sent.push({ characterId: recipient.characterId, name: recipient.name });
  }

  return { sent, failed, skipped };
}

// The PUBLIC half: a post into every channel the declaration reaches, plus the
// Hall's own row (SURFACE: the #summary alone; underground: every Location
// channel — db/lib/publicPostTargets.js). ONE DELIVERY ROW PER CHANNEL, so a
// fan-out never has to choose between SENT-with-some-channels or FAILED-and-repost.
// `writeSceneLine`: a resend after a SUCCEEDED post must not write a second /play row; after a FAILED one it must.
async function deliverPublic(
  prisma,
  { stagedMessage, targets = [], zone = null, zoneId, writeSceneLine = true },
) {
  const rows = await ensureDeliveries(prisma, { stagedMessage, recipients: targets });
  const placeholderKey = deliveryKeyFor(stagedMessage.id, null);

  // Nowhere to post: an unprovisioned #summary for a surface zone, or Locations with no channels yet for a cave level.
  if (!targets.length) {
    const failure = {
      error:
        zone?.kind === "CAVE_LEVEL"
          ? "no location channels in this cave"
          : "no summary channel configured",
      status: null,
    };
    // Guarded: a row already SENT or IN_FLIGHT under a claim must not be flipped to FAILED. BY KEY, not by position.
    const marked = await prisma.delivery.updateMany({
      where: {
        stagedMessageId: stagedMessage.id,
        dedupeKey: placeholderKey,
        state: { notIn: ["SENT", "IN_FLIGHT"] },
      },
      data: { state: "FAILED", claimedAt: null, lastError: failure },
    });
    if (!marked.count) return { sent: 0, failed: [], skipped: 1, attempted: 0 };
    return { sent: 0, failed: [failure], skipped: 0, attempted: 0 };
  }

  // The "nowhere to post" row a previous attempt left, now that there IS somewhere. SENT and IN_FLIGHT are never touched either way.
  const targetKeys = new Set(targets.map((t) => deliveryKeyFor(stagedMessage.id, t)));
  if (!targetKeys.has(placeholderKey)) {
    await prisma.delivery
      .deleteMany({
        where: {
          stagedMessageId: stagedMessage.id,
          dedupeKey: placeholderKey,
          state: { notIn: ["SENT", "IN_FLIGHT"] },
        },
      })
      .catch((err) =>
        console.error(`Pruning the placeholder delivery for ${stagedMessage.id} failed:`, err),
      );
  }

  const byKey = new Map(rows.map((row) => [row.dedupeKey, row]));
  let sent = 0;
  let skipped = 0;
  const failed = [];

  // Sequential, one channel at a time, never Promise.all — same discipline as db/lib/worldBroadcast.js.
  for (const target of targets) {
    const delivery = byKey.get(deliveryKeyFor(stagedMessage.id, target));
    if (!delivery) {
      skipped += 1; // couldn't be written, so nothing to claim or send.
      continue;
    }
    if (delivery.state === "SENT") {
      skipped += 1;
      continue;
    }
    if (!(await claimDelivery(prisma, delivery))) {
      skipped += 1;
      continue;
    }

    try {
      await discordRest.postMessageBatched(target.channelId, stagedMessage.content); // batched, over 2000 chars (ADJUDICATION.md §1).
    } catch (err) {
      const failure = describeFailure(err);
      await prisma.delivery
        .update({
          where: { id: delivery.id },
          data: { state: "FAILED", claimedAt: null, lastError: failure },
        })
        .catch((markErr) => console.error(`Failed to mark delivery ${delivery.id}:`, markErr));
      failed.push({ name: target.name ?? null, ...failure });
      continue;
    }

    // THE POST HAPPENED. Nothing below may turn it back into a failure — a
    // FAILED row here invites posting the declaration a second time.
    try {
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { state: "SENT", sentAt: new Date(), claimedAt: null, lastError: null },
      });
    } catch (markErr) {
      console.error(
        `POST SENT BUT NOT STAMPED — delivery ${delivery.id} (staged message ${stagedMessage.id}) reached ${target.name ?? "the summary channel"} and the row is still IN_FLIGHT:`,
        markErr,
      );
    }
    sent += 1;
  }

  // ONE row per message, never one per channel — the Hall row is the ZONE's.
  // Gated on `sent`, so a declaration that reached nobody writes no row and Resend can still write it later.
  if (writeSceneLine && zoneId && sent > 0) {
    await sceneLineAt(prisma, { zoneId, text: stagedMessage.content, signed: false }).catch((err) =>
      console.error(`Hall row for staged message ${stagedMessage.id} failed:`, err),
    );
  }

  return { sent, failed, skipped, attempted: targets.length };
}

// Rows a message pushed BEFORE this table existed never got. Left alone, the
// shared path writes them fresh as PENDING, which reads as "never attempted".
// Reconstructed instead: sentAt says every recipient was attempted,
// deliveryFailures names the ones that bounced. Only ever called with no
// existing rows; the moment there is one, this never runs again.
async function backfillLegacyDeliveries(prisma, { stagedMessage, recipients, priorFailures = [] }) {
  if (!stagedMessage?.sentAt) return false;
  const existing = await prisma.delivery.count({ where: { stagedMessageId: stagedMessage.id } });
  if (existing) return false;

  const failures = Array.isArray(priorFailures) ? priorFailures : [];
  const isPublic = stagedMessage.kind === "PUBLIC";
  // Still `[null]`: this only ever runs on a legacy message, every one of which posted to a #summary.
  const list = isPublic ? [null] : (recipients ?? []);

  const rows = list.map((r) => {
    const failure = isPublic
      ? (failures[0] ?? null)
      : (failures.find(
          (f) =>
            (f?.characterId && r?.characterId && f.characterId === r.characterId) ||
            (!f?.characterId && f?.name && r?.name && f.name === r.name),
        ) ?? null);
    return {
      stagedMessageId: stagedMessage.id,
      characterId: r?.characterId ?? null,
      discordUserId: r?.discordUserId ?? null,
      name: r?.name ?? null,
      dedupeKey: deliveryKeyFor(stagedMessage.id, r ?? null),
      state: failure ? "FAILED" : "SENT",
      sentAt: failure ? null : stagedMessage.sentAt,
      attempts: 1,
      lastError: failure ? { error: failure.error ?? "unknown error", status: failure.status ?? null } : undefined,
    };
  });
  if (!rows.length) return false;
  await prisma.delivery.createMany({ data: rows, skipDuplicates: true });
  return true;
}

// Derived rather than accumulated, so the blob and the rows cannot drift.
async function failuresFor(prisma, stagedMessageId) {
  const rows = await prisma.delivery.findMany({
    where: { stagedMessageId, state: "FAILED" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    characterId: r.characterId,
    name: r.name,
    ...(r.lastError ?? { error: "unknown error" }),
  }));
}

module.exports = {
  deliverPrivate,
  deliverPublic,
  ensureDeliveries,
  backfillLegacyDeliveries,
  claimDelivery,
  isRetryable,
  deliveryKeyFor,
  failuresFor,
  STALE_CLAIM_MS,
};
