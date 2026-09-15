// The per-turn lesson pass, run from db/index.js#resolveNeeds() between
// "defaultMoves" and "stagedPush" (docs/systemdocs/LESSONS.md).
//
// Every ACCEPTED lesson on the closing turn is rolled here: the learner's
// stored Gambit die plus its modifier against the offer's threshold. A pass
// grants the skill (TagSource LESSON) and drops the tiers below it; either
// way the learner's Action is SOLVED with a result line, so the staged push
// closes it as adjudicated rather than silently. Every PENDING offer on the
// turn expires here, whatever its kind — lesson, bind or confession — so
// db/lib/confessionPass.js deliberately does no expiring of its own.
//
// Returns Discord work as data for advanceTurn()'s runSideEffects(), never
// sends it. Returns an object even when idle: db/index.js treats null as a
// failed pass to retry.
const { addToStack, replaceLowerTiers } = require("./tagWrites");
const { LESSON_THRESHOLD } = require("./constants");
// For the SEARCH expiry line only — see presentedNameOf below.
const { seenAs, identityOf, IDENTITY_SELECT } = require("./intercept");
const { capitalizeFirst } = require("./concealedIdentity");

function rollLine(turn, action, bonus = 0) {
  const mod = (action.diceModifier ?? 0) + bonus;
  const total = (action.diceRoll ?? 0) + mod;
  const die = mod
    ? `**${action.diceRoll}** (${mod > 0 ? `+${mod}` : mod}) → **${total}**`
    : `**${action.diceRoll}**`;
  return { text: `🎲 Your Gambit for turn ${turn.number}: ${die}`, total };
}

async function runLessonPass(prisma, turn) {
  const idle = {
    turnNumber: turn.number,
    resolved: 0,
    learned: 0,
    expired: 0,
    failed: 0,
    dms: [],
  };
  const [accepted, pending] = await Promise.all([
    prisma.offer.findMany({
      where: { kind: "LESSON", status: "ACCEPTED", turnId: turn.id },
      include: { tag: true },
    }),
    prisma.offer.findMany({
      where: { status: "PENDING", turnId: turn.id },
      include: { tag: true },
    }),
  ]);
  if (accepted.length === 0 && pending.length === 0) return idle;

  const ids = new Set();
  for (const o of [...accepted, ...pending]) {
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
  let resolved = 0;
  let learned = 0;
  let failed = 0;

  for (const offer of accepted) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const action = offer.learnerActionId
          ? await tx.action.findUnique({ where: { id: offer.learnerActionId } })
          : null;
        // A GM rejected the learner's Move; the lesson went with it.
        if (!action) {
          await tx.offer.update({
            where: { id: offer.id },
            data: {
              status: "CANCELLED",
              resolvedAt: new Date(),
              outcome: { cancelledBy: "missing_action" },
            },
          });
          return null;
        }
        // A GM already wrote a result. Theirs stands; the die does not grant.
        if (action.moveReviewStatus === "SOLVED") {
          await tx.offer.update({
            where: { id: offer.id },
            data: {
              status: "RESOLVED",
              resolvedAt: new Date(),
              outcome: { gmDecided: true },
            },
          });
          return null;
        }
        const learner = people.get(offer.learnerId);
        // The Minted Charm (docs/tags.yaml): +1 to the wearer's Learn roll
        // while EQUIPPED at resolution — the student-side sibling of
        // Teaching (Drill Instructor), which moves the threshold from the
        // teacher's side instead.
        const charm = await tx.characterTag.findFirst({
          where: { characterId: offer.learnerId, equipped: true, tag: { slug: "minted-charm" } },
          select: { id: true },
        });
        const charmBonus = charm ? 1 : 0;
        const { text, total } = rollLine(turn, action, charmBonus);
        const threshold = offer.threshold ?? LESSON_THRESHOLD;
        const succeeded = learner?.status === "ALIVE" && total >= threshold;
        const skill = offer.tag?.name ?? "the skill";
        let replaced = [];
        if (succeeded && offer.tag) {
          const already = await tx.characterTag.findUnique({
            where: {
              characterId_tagId: {
                characterId: offer.learnerId,
                tagId: offer.tagId,
              },
            },
          });
          if (!already) {
            replaced = await replaceLowerTiers(
              tx,
              offer.learnerId,
              offer.tagId,
            );
            await addToStack(tx, offer.learnerId, offer.tagId, 1, {
              source: "LESSON",
            });
          }
        }
        const resultMessage = succeeded
          ? `Learned ${skill} from ${nameOf(offer.teacherId)} (${total} vs ${threshold}).`
          : `Failed to learn ${skill} from ${nameOf(offer.teacherId)} (${total} vs ${threshold}).`;
        await tx.action.update({
          where: { id: action.id },
          data: {
            moveReviewStatus: "SOLVED",
            reviewedAt: new Date(),
            resultMessage,
          },
        });
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            outcome: {
              diceRoll: action.diceRoll,
              diceModifier: action.diceModifier ?? 0,
              charmBonus,
              total,
              threshold,
              succeeded,
              replaced,
            },
          },
        });
        return { text, succeeded, skill, replaced };
      });
      if (!outcome) continue;
      resolved += 1;
      if (outcome.succeeded) learned += 1;
      const teacherName = nameOf(offer.teacherId);
      const learnerName = nameOf(offer.learnerId);
      const learnerDm = dmTo(
        offer.learnerId,
        outcome.succeeded
          ? `${outcome.text} → you learned **${outcome.skill}** from ${teacherName}.`
          : `${outcome.text} → you didn't learn **${outcome.skill}** this time.`,
      );
      const teacherDm = dmTo(
        offer.teacherId,
        outcome.succeeded
          ? `${learnerName} picked up **${outcome.skill}**.`
          : `${learnerName} didn't learn **${outcome.skill}**.`,
      );
      for (const dm of [learnerDm, teacherDm]) if (dm) dms.push(dm);
    } catch (err) {
      failed += 1;
      console.error(`Lesson ${offer.id} failed to resolve:`, err);
    }
  }

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

  return { turnNumber: turn.number, resolved, learned, expired, failed, dms };
}

module.exports = { runLessonPass, rollLine };
