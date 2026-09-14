const { Prisma } = require("@prisma/client");
const { deliverPrivate, failuresFor } = require("../../stagedDelivery");

// Staged-arbitration deliveries (docs/systemdocs/ADJUDICATION.md §1a).
//
// One Delivery row per recipient carries the state now, and
// db/lib/stagedDelivery.js is the same code the Resend button runs — so a
// bounce is a FAILED row a later attempt can claim, rather than a step key
// that says "done" because the loop did not throw. The step ladder still
// wraps the message as a whole (a message fully delivered is not re-walked
// on a resume), but the per-recipient no-double-send promise no longer
// depends on it: the claim does.
//
// The error is NOT swallowed inside step() any more — deliverPrivate hands
// back what failed and the key is recorded either way, because the rows
// below are what a retry reads, not the key.
async function deliverStagedPrivate({ prisma, p, list, step }, deliveryFailures) {
  for (const delivery of list(p.privateDeliveries)) {
    await step(`delivery:${delivery.stagedMessageId}`, async () => {
      const stagedMessage = {
        id: delivery.stagedMessageId,
        content: delivery.content,
        createdByDiscordUserId: delivery.createdByDiscordUserId ?? null,
      };
      const { failed, skipped } = await deliverPrivate(prisma, {
        stagedMessage,
        recipients: list(delivery.recipients),
      });
      // sentAt says "delivery was attempted for every recipient", which is
      // what the tray's missed-push banner reads. The failure list is derived
      // from the rows rather than from this run — ALWAYS, not only when this
      // run bounced somebody. A run that fails nobody can still be looking at a
      // message with FAILED rows on it (a partial push resumed, or a Resend
      // running beside it), and blanking the blob there told the tray the
      // message was clean while the rows said otherwise.
      const rowFailures = await failuresFor(prisma, delivery.stagedMessageId);
      await prisma.stagedMessage
        .update({
          where: { id: delivery.stagedMessageId },
          data: {
            sentAt: new Date(),
            deliveryFailures: rowFailures.length ? rowFailures : Prisma.DbNull,
          },
        })
        .catch((err) =>
          console.error(`Failed to stamp staged message ${delivery.stagedMessageId} sent:`, err),
        );
      if (failed.length || skipped.length)
        deliveryFailures.push({
          stagedMessageId: delivery.stagedMessageId,
          attempted: list(delivery.recipients).length,
          delivered: list(delivery.recipients).length - failed.length - skipped.length,
          failed,
          // Somebody else's claim — a Resend pressed mid-push, or a second
          // runner. Not a bounce, but not a delivery either, and a GM reading
          // the audit row needs the count to add up.
          ...(skipped.length ? { skipped } : {}),
        });
      // THE KEY IS NOT RECORDED WHEN ANYBODY BOUNCED. That is the whole reason
      // the step ladder stopped being the record: a recorded key means "never
      // walk this message again", and a resumed push must retry a bounce. The
      // rows underneath are idempotent, so re-walking costs a SENT recipient
      // nothing. A skip is somebody else's claim, and re-walking that is free
      // too, so it counts as unfinished for the same reason.
      if (failed.length || skipped.length)
        throw new Error(
          `staged message ${delivery.stagedMessageId}: ${failed.length} bounced, ${skipped.length} held by another run`,
        );
    });
  }
}

module.exports = { deliverStagedPrivate };
