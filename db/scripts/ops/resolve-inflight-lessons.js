// One-off. A lesson resolves the moment it is accepted now (db/lib/lessons.js), and the
// turn-end half that used to settle them is gone — so any lesson ACCEPTED before that
// shipped has nobody left to come for it. This settles those, once, and can then be
// deleted along with this file.
//
// RUN IT BEFORE THE CODE DEPLOYS, not after: the moment the new lessons.js is live the
// old rows are orphaned, and every turn that passes without this is a day somebody spent
// on a lesson that never happened.
//
// `npm run db:resolve-inflight-lessons` to preview, `-- --apply` to settle. Dry run by
// default, like every other script in here.
require("dotenv").config();
const { prisma } = require("../../index");
const { lessonOutcome } = require("../../lib/lessons");
const { addToStack, replaceLowerTiers } = require("../../lib/tagWrites");
const { LESSON_THRESHOLD } = require("../../lib/constants");

// Deliberately NOT scoped to the open turn. The pass only ever looked at the turn it was
// closing, so a lesson stranded by a missed advance could be older than that.
async function inflightLessons() {
  return prisma.offer.findMany({
    where: { kind: "LESSON", status: "ACCEPTED" },
    include: {
      tag: { select: { id: true, name: true } },
      turn: { select: { number: true } },
    },
    orderBy: { respondedAt: "asc" },
  });
}

async function settle(offer, { apply }) {
  const action = offer.learnerActionId
    ? await prisma.action.findUnique({ where: { id: offer.learnerActionId } })
    : null;

  // A GM rejected the learner's Move and the lesson went with it — the same arm the old
  // pass had. Nothing to grant; just stop the row hanging around ACCEPTED forever.
  if (!action) {
    if (apply) {
      await prisma.offer.update({
        where: { id: offer.id },
        data: {
          status: "CANCELLED",
          resolvedAt: new Date(),
          outcome: { cancelledBy: "missing_action" },
        },
      });
    }
    return { verdict: "cancelled", reason: "the learner's Move is gone" };
  }

  // A GM already solved it by hand. Theirs stands, exactly as the old pass decided — and
  // this is the case worth counting, because a hand-solved lesson granted nothing.
  if (action.moveReviewStatus === "SOLVED") {
    if (apply) {
      await prisma.offer.update({
        where: { id: offer.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), outcome: { gmDecided: true } },
      });
    }
    return { verdict: "gm-decided", reason: "a GM solved it; no skill was granted" };
  }

  const [learner, charm] = await Promise.all([
    prisma.character.findUnique({
      where: { id: offer.learnerId },
      select: { id: true, name: true, status: true },
    }),
    prisma.characterTag.findFirst({
      where: { characterId: offer.learnerId, equipped: true, tag: { slug: "minted-charm" } },
      select: { id: true },
    }),
  ]);

  const threshold = offer.threshold ?? LESSON_THRESHOLD;
  const { total, succeeded } = lessonOutcome({
    die: action.diceRoll,
    diceModifier: action.diceModifier ?? 0,
    charmBonus: charm ? 1 : 0,
    threshold,
    learnerStatus: learner?.status,
  });

  if (!apply) {
    return {
      verdict: succeeded ? "would learn" : "would fail",
      reason: `${total} vs ${threshold}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    let replaced = [];
    if (succeeded && offer.tagId) {
      const already = await tx.characterTag.findUnique({
        where: { characterId_tagId: { characterId: offer.learnerId, tagId: offer.tagId } },
      });
      if (!already) {
        replaced = await replaceLowerTiers(tx, offer.learnerId, offer.tagId);
        await addToStack(tx, offer.learnerId, offer.tagId, 1, { source: "LESSON" });
      }
    }
    const skill = offer.tag?.name ?? "the skill";
    await tx.action.update({
      where: { id: action.id },
      data: {
        // PASSED, matching what the accept path writes now — not SOLVED, which would read
        // as a GM having judged it.
        moveReviewStatus: "PASSED",
        reviewedAt: new Date(),
        appliedEffects: {},
        resultMessage: succeeded
          ? `Learned ${skill} (${total} vs ${threshold}).`
          : `Failed to learn ${skill} (${total} vs ${threshold}).`,
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
          charmBonus: charm ? 1 : 0,
          total,
          threshold,
          succeeded,
          replaced,
          settledBy: "resolve-inflight-lessons",
        },
      },
    });
  });

  return {
    verdict: succeeded ? "learned" : "failed",
    reason: `${total} vs ${threshold}`,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const offers = await inflightLessons();

  if (offers.length === 0) {
    console.log("No lesson is waiting on the old turn-end pass. Nothing to do.");
    return;
  }

  console.log(
    `${apply ? "Settling" : "Would settle"} ${offers.length} in-flight lesson(s):`,
  );
  const tally = new Map();
  for (const offer of offers) {
    try {
      const { verdict, reason } = await settle(offer, { apply });
      tally.set(verdict, (tally.get(verdict) ?? 0) + 1);
      const turn = offer.turn ? `turn ${offer.turn.number}` : "an unknown turn";
      console.log(`  - ${offer.tag?.name ?? "a skill"}, ${turn} — ${verdict} (${reason})`);
    } catch (err) {
      tally.set("failed", (tally.get("failed") ?? 0) + 1);
      console.error(`  - ${offer.id} FAILED:`, err.message ?? err);
    }
  }

  console.log("");
  for (const [verdict, n] of tally) console.log(`  ${verdict}: ${n}`);
  // Nobody is DM'd. These lessons happened turns ago and a notice now would be a message
  // about a day the player has long since stopped waiting on; their sheet is the record.
  if (apply) console.log("\nNo DMs were sent — see the note in this script.");
  else console.log("\nDry run. Nothing was written. Pass -- --apply to settle.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
