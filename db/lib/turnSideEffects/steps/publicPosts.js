const { Prisma } = require("@prisma/client");
const { publicPostTargets } = require("../../publicPostTargets");
const { deliverPublic, failuresFor } = require("../../stagedDelivery");

async function deliverPublicPosts({ prisma, p, list, step }, deliveryFailures) {
  for (const post of list(p.publicPosts)) {
    await step(`publicPost:${post.stagedMessageId}`, async () => {
      const stagedMessage = {
        id: post.stagedMessageId,
        content: post.content,
        createdByDiscordUserId: null,
      };
      // Resolved LIVE, not carried in the payload. Where a declaration goes is
      // a list now — one #summary, or every Location channel in a cave level
      // (db/lib/publicPostTargets.js) — and a list of channel ids frozen at
      // turn-close and replayed by a resumed push hours later is the same stale
      // -payload problem the turn and the wipe switch are re-read for below.
      const { zone, targets } = await publicPostTargets(prisma, post.zoneId);
      const { sent, failed, skipped, attempted } = await deliverPublic(prisma, {
        stagedMessage,
        targets,
        zone,
        zoneId: post.zoneId,
        // The push is always the FIRST attempt at a declaration, so the Hall
        // row is always its to write. Only Resend has a reason to skip it.
        writeSceneLine: true,
      });
      // Derived from the rows, not from this run's own bounces — the same fix
      // and the same reason as the PRIVATE block above: a channel a Resend
      // running beside this one just got through to must not still be listed
      // as failing here.
      const rowFailures = await failuresFor(prisma, post.stagedMessageId).catch(() => failed);
      await prisma.stagedMessage
        .update({
          where: { id: post.stagedMessageId },
          data: {
            // A post that reached NO channel never went anywhere, so it is not
            // stamped sent — it stays in the tray as unsent work, the way it
            // did. One that reached some of them is stamped: it did reach
            // players, the bounces live on their own rows for Resend to retry,
            // and leaving it unstamped would get it re-selected by the next
            // push and re-posted to every channel that already has it.
            ...(sent ? { sentAt: new Date() } : {}),
            deliveryFailures: rowFailures.length ? rowFailures : Prisma.DbNull,
          },
        })
        .catch((err) =>
          console.error(`Failed to stamp public post ${post.stagedMessageId}:`, err),
        );
      if (failed.length || skipped) {
        console.error(
          `Public declaration ${post.stagedMessageId} reached ${sent} of ${attempted} channels:`,
          failed.map((f) => `${f.name ?? "the channel"}: ${f.error}`).join("; ") || "the rest were held",
        );
        deliveryFailures.push({
          stagedMessageId: post.stagedMessageId,
          attempted,
          delivered: sent,
          failed,
          // Claimed by a run happening right now. Neither a send nor a bounce,
          // and leaving it out makes the audit row's counts fail to add up —
          // which reads as lost mail. Same shape the PRIVATE block uses.
          ...(skipped ? { skipped } : {}),
        });
      }
    });
  }

  if (deliveryFailures.length) {
    await step("deliveryFailureLog", () =>
      prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "staged_push_delivery_failed",
            details: { failures: deliveryFailures },
          },
        })
        .catch((err) =>
          console.error("Failed to log staged_push_delivery_failed:", err),
        ),
    );
  }
}

module.exports = { deliverPublicPosts };
