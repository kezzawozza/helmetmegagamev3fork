// Expires every PENDING offer on the closing turn, whatever its kind — lesson, bind,
// confession, kiss, escort or search. One pass for all of them on purpose, which is why
// db/lib/confessionPass.js deliberately does no expiring of its own; two passes racing
// the same rows would double-DM.
//
// It used to RESOLVE accepted lessons too, and was named for that. It doesn't any more:
// a lesson resolves in the transaction that accepts it (db/lib/lessons.js), so by the
// time this runs there is nothing accepted left to settle. What stayed is the half that
// was never about lessons at all.
//
// The pass is still keyed "lessons" in TURN_PASSES. That key is written into
// Turn.resolvedPasses, so renaming it would make every half-resolved turn look like it
// still owed this pass — the same reason `move_unlock` and `move_rejected` kept their
// names through their own renames (CLAUDE.md).
//
// Returns Discord work as data for advanceTurn()'s runSideEffects(), never sends it.
// Returns an object even when idle: db/index.js treats null as a failed pass to retry.
// For the SEARCH expiry line only — see presentedNameOf below.
const { seenAs, identityOf, IDENTITY_SELECT } = require("./intercept");
const { capitalizeFirst } = require("./concealedIdentity");

async function runOfferExpiryPass(prisma, turn) {
  const idle = {
    turnNumber: turn.number,
    expired: 0,
    failed: 0,
    dms: [],
  };
  const pending = await prisma.offer.findMany({
    where: { status: "PENDING", turnId: turn.id },
    include: { tag: true },
  });
  if (pending.length === 0) return idle;

  const ids = new Set();
  for (const o of pending) {
    ids.add(o.initiatorId);
    ids.add(o.responderId);
    if (o.teacherId) ids.add(o.teacherId);
    if (o.learnerId) ids.add(o.learnerId);
  }
  const people = new Map(
    (
      await prisma.character.findMany({
        where: { id: { in: [...ids] } },
        // IDENTITY_SELECT rather than a bare name, so presentedNameOf below
        // can answer. It carries id/name/discordUserId/status already.
        select: IDENTITY_SELECT,
      })
    ).map((c) => [c.id, c]),
  );
  const nameOf = (id) => people.get(id)?.name ?? "someone";
  // Search is the one kind either end of which may be hooded, so its expiry
  // notice is the one that must name the face rather than the row — the same
  // rule INTERCEPT.md §2 applies to every other line about a concealed person.
  const presentedNameOf = (id) => {
    const row = people.get(id);
    return row ? capitalizeFirst(seenAs(identityOf(row))) : "Someone";
  };
  const dmTo = (id, content) => {
    const c = people.get(id);
    return c?.discordUserId
      ? { discordUserId: c.discordUserId, content }
      : null;
  };

  const dms = [];
  let failed = 0;

  let expired = 0;
  for (const offer of pending) {
    try {
      const claim = await prisma.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
      if (claim.count === 0) continue;
      expired += 1;
      const other = nameOf(offer.responderId);
      // One line per kind, and the lesson pair is the DEFAULT arm rather than
      // one more branch — which is why every kind added since has to appear
      // here or its expiry notice says "your offer to teach a skill". KISS and
      // ESCORT were both reading that way until Search arrived and made the
      // gap obvious; the two lines below are that fix, not new behaviour.
      const content =
        offer.kind === "BIND"
          ? `${other} didn't answer. The turn is over.`
          : offer.kind === "CONFESSION"
            ? // Never names the tag: an expiry notice is not the place to
              // start writing somebody's sins into a DM log.
              `${other} never heard your confession. Your Move wasn't spent.`
            : offer.kind === "KISS"
              ? `${other} never answered you.`
              : offer.kind === "ESCORT"
                ? `${other} never answered. They aren't coming with you.`
                : offer.kind === "SEARCH"
                  ? // Never names what they were carrying: nothing was found,
                    // and an expiry notice is not a consolation readout.
                    `${presentedNameOf(offer.responderId)} never answered your search.`
                  : offer.initiatorId === offer.learnerId
                    ? `${other} never answered your offer to learn ${offer.tag?.name ?? "a skill"}. Your Move wasn't spent.`
                    : `${other} never answered your offer to teach ${offer.tag?.name ?? "a skill"}. Your Move wasn't spent.`;
      const dm = dmTo(offer.initiatorId, content);
      if (dm) dms.push(dm);
    } catch (err) {
      failed += 1;
      console.error(`Offer ${offer.id} failed to expire:`, err);
    }
  }

  return { turnNumber: turn.number, expired, failed, dms };
}

module.exports = { runOfferExpiryPass };
