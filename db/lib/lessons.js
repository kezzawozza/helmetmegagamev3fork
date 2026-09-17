// Lessons: the Learn Skill / Teach Skill handshake (docs/systemdocs/LESSONS.md).
//
// A lesson is an Offer of kind LESSON between a teacher and a learner around
// one teachable skill. ANYONE may teach — the Teaching tag is not a door any
// more, it is what makes teaching cheap and good. Either side may start it
// from their sheet; the other gets a DM with Accept / Decline.
//
// Accepting always files the learner's Gambit. It files a Routine for the
// teacher only when the teacher LACKS Teaching: an untrained teacher spends
// their day on it and their student needs a 6. A Teaching holder spends
// nothing, may already have locked in some other Move, and carries up to
// TEACHING_CAPACITY students a turn; their student needs a 5.
//
// The result is rolled and applied the moment the offer is accepted. This is
// the game's first code-adjudicated Gambit: a fixed threshold on the modified
// die, nothing for a GM to narrate.
//
// Takes `prisma` as the first parameter (the db/lib/dm.js convention) and is
// NOT on the @lifeweb/db barrel; require it by path. Web files the offer and
// the bot answers the click, so everything both sides check lives here.
const { rollWithAdvantage } = require("./advantage");
const { addToStack, replaceLowerTiers } = require("./tagWrites");
const { gambitModifierTotal, rollLine } = require("./gambitModifier");
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const {
  TEACHING_SLUG,
  DRILL_INSTRUCTOR_SLUG,
  FIGHTING_GROUP_SLUG,
  TEACHING_CAPACITY,
  UNTAUGHT_LESSON_THRESHOLD,
  LESSON_THRESHOLD,
  DRILL_THRESHOLD,
} = require("./constants");

// What a lesson needs to know about each side. mood feeds the learner's
// Gambit modifier, same as a hand-filed Gambit (Hunger comes off held tags
// instead, already part of `tags` below).
// `equipped` and the hood fields are for presence.js#isHere: a forcing hood hides a teacher the column doesn't.
const { CONCEALMENT_TAG_FIELDS } = require("./presentedIdentity");
const { movesOpen } = require("./turnGate");
const LESSON_CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  zoneId: true,
  concealed: true,
  buriedAt: true,
  discordUserId: true,
  mood: true,
  tags: {
    select: {
      tagId: true,
      quantity: true,
      equipped: true,
      tag: {
        select: {
          ...CONCEALMENT_TAG_FIELDS,
          id: true,
          slug: true,
          name: true,
          forcedName: true,
          parentTagId: true,
          groupId: true,
          // Read back by db/lib/gambitModifier.js for the lesson's Gambit.
          gambitBonus: true,
        },
      },
    },
  },
};

// The catalog columns teachableSkills reads.
const LESSON_CATALOG_SELECT = {
  id: true,
  slug: true,
  name: true,
  teachable: true,
  parentTagId: true,
  requiredTagId: true,
  group: { select: { slug: true, requiredTagId: true } },
  // Named conflicts (Tag.conflictsWith). Without this column a lesson is the
  // way round every conflict pair in the catalog: Soft Hands cannot BUY
  // Prospecting, but could always have been taught it.
  conflictsWith: { select: { id: true } },
};

// --- eligibility ---------------------------------------------------------

function parentMap(catalog) {
  return new Map(catalog.map((t) => [t.id, t.parentTagId ?? null]));
}

// Does holding any of `heldIds` count as holding `tagId`? True when they
// hold it, or a higher tier in its own parentTagId chain (a surgeon has a
// nurse's skill). Cycle-guarded like db/lib/medicalVision.js.
function holdsTier(heldIds, tagId, parentOf) {
  for (const id of heldIds) {
    const seen = new Set();
    let cursor = id;
    while (cursor && !seen.has(cursor)) {
      if (cursor === tagId) return true;
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return false;
}

function heldTagIds(character) {
  return (character?.tags ?? [])
    .map((ct) => ct.tagId ?? ct.tag?.id)
    .filter(Boolean);
}

function heldSlugs(character) {
  return new Set(
    (character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
  );
}

// Does this character teach for FREE? Everyone can teach; holding Teaching is
// what makes it cost no Move. Deliberately not called isTeacher any more —
// that name read as "may teach at all", which is now true of everybody.
function teachesFree(character) {
  return heldSlugs(character).has(TEACHING_SLUG);
}

// The skills `teacher` can teach `learner` right now: teachable, held by the
// teacher (or a higher tier of it), not yet held by the learner at that tier
// or above, with the learner holding its parent tier and any gate, and with
// nothing the learner already holds named as a conflict. Same gates as buying
// it — a lesson can't skip a prerequisite the store won't, and it can't skip a
// conflict either. Soft Hands has never done a day's work, and no amount of
// being taught changes that.
//
// Split in two so neither side's picker has to read the OTHER sheet: Learn
// lists learnableSkills(me), Teach lists knownTeachableSkills(me), and only
// the server ever puts the two together.
function teachableSkills(teacher, learner, catalog) {
  const known = new Set(knownTeachableSkills(teacher, catalog).map((t) => t.id));
  return learnableSkills(learner, catalog).filter((t) => known.has(t.id));
}

// Teachable skills this character holds (or holds a higher tier of).
function knownTeachableSkills(teacher, catalog) {
  const parentOf = parentMap(catalog);
  const teacherHeld = heldTagIds(teacher);
  return catalog.filter((tag) => tag.teachable && holdsTier(teacherHeld, tag.id, parentOf));
}

// Teachable skills this character could take from somebody who knows them.
function learnableSkills(learner, catalog) {
  const parentOf = parentMap(catalog);
  const learnerHeld = heldTagIds(learner);
  return catalog.filter((tag) => {
    if (!tag.teachable) return false;
    if (holdsTier(learnerHeld, tag.id, parentOf)) return false;
    if (tag.parentTagId && !holdsTier(learnerHeld, tag.parentTagId, parentOf))
      return false;
    if (
      tag.requiredTagId &&
      !holdsTier(learnerHeld, tag.requiredTagId, parentOf)
    )
      return false;
    if (
      tag.group?.requiredTagId &&
      !holdsTier(learnerHeld, tag.group.requiredTagId, parentOf)
    )
      return false;
    // Exact ids, not holdsTier: a conflict is with the named tag itself, and
    // walking the chain would let one conflicting tier shut out its siblings.
    // db:sync-tags writes conflictsWith both ways, so one direction is enough.
    const held = new Set(learnerHeld);
    if ((tag.conflictsWith ?? []).some((c) => held.has(c.id))) return false;
    return true;
  });
}

// What the student needs on the modified die, in order: 4 for a fighting skill
// under a Drill Instructor, 5 from anyone else holding Teaching, 6 from someone
// teaching what they know with no idea how to teach it. Drill Instructor's
// requiredTag is Teaching, so the first two rungs can never disagree.
function lessonThreshold(teacher, skill) {
  const slugs = heldSlugs(teacher);
  if (
    slugs.has(DRILL_INSTRUCTOR_SLUG) &&
    skill?.group?.slug === FIGHTING_GROUP_SLUG
  )
    return DRILL_THRESHOLD;
  return slugs.has(TEACHING_SLUG)
    ? LESSON_THRESHOLD
    : UNTAUGHT_LESSON_THRESHOLD;
}

// --- shared checks -------------------------------------------------------

const GONE = "That offer's gone.";
const LOCKED_IN = "You've already locked in a Move this turn.";

// A thin shim over db/lib/turnGate.js#movesOpen, kept only because both call sites here want the turn row back as well as
// the verdict. `blocked` is the reason to say out loud, null when the player may act — which covers the lock AND the game
// being out of session, two things this used to have no way to tell apart.
async function openTurnAndWindow(db) {
  const gate = await movesOpen(db);
  return { turn: gate.turn, locked: !gate.ok, blocked: gate.message };
}

// Can this teacher take this lesson on? Two different questions, depending on
// the tag. Returns { ok, free, reason } — `free` says no Routine is owed, so
// acceptLesson knows not to file one.
//
// A Teaching holder's Move slot is never read: teaching costs them nothing and
// they may be mining, travelling or running a Gambit at the same time. Their
// only limit is TEACHING_CAPACITY students a turn, counted off the offers
// themselves rather than off an Action id, because there is no Action.
//
// Everyone else owes a whole Routine, so any Move already locked in refuses —
// which is also what caps an untrained teacher at one student a turn.
async function teacherSlot(db, teacher, turnId, { excludeOfferId } = {}) {
  if (teachesFree(teacher)) {
    const taken = await db.offer.count({
      where: {
        kind: "LESSON",
        turnId,
        teacherId: teacher.id,
        status: { in: ["ACCEPTED", "RESOLVED"] },
        // acceptLesson claims THIS offer before it asks, so it would otherwise
        // count itself and turn a cap of three into a cap of two.
        ...(excludeOfferId ? { id: { not: excludeOfferId } } : {}),
      },
    });
    if (taken >= TEACHING_CAPACITY)
      return {
        ok: false,
        reason: `${teacher.name} can't take on another student this turn.`,
      };
    return { ok: true, free: true };
  }
  const action = await db.action.findFirst({
    where: { characterId: teacher.id, turnId },
    select: { id: true },
  });
  return action
    ? {
        ok: false,
        reason: `${teacher.name} has already locked in a Move this turn.`,
      }
    : { ok: true, free: false };
}

async function learnerSlot(db, learner, turnId) {
  const action = await db.action.findFirst({
    where: { characterId: learner.id, turnId },
    select: { id: true },
  });
  return action
    ? {
        ok: false,
        reason: `${learner.name} has already locked in a Move this turn.`,
      }
    : { ok: true };
}

// Everything a lesson needs true, checked the same way at offer time and
// again at accept time. `initiatorId` decides whose Move slot is checked
// now (at accept, both are).
async function validateLesson(
  db,
  { teacher, learner, tag, turnId, checkSlotsFor, excludeOfferId },
) {
  if (!teacher || teacher.status !== "ALIVE")
    return "That teacher isn't around any more.";
  if (!learner || learner.status !== "ALIVE")
    return "That student isn't around any more.";
  if (teacher.id === learner.id) return "You can't teach yourself.";
  // allowConcealed on both ends: a lesson is two people standing next to each
  // other, and there is nothing about a mask that stops one being given or
  // taken. The offer handshake is the consent either way, and nothing here
  // reads the far sheet (LESSONS.md §4). Co-presence itself is what matters,
  // and that is a physical fact a hood does not change.
  if (!isHere(teacher, learner, { allowConcealed: true })) return notHereMessage(learner);
  if (!isHere(learner, teacher, { allowConcealed: true })) return notHereMessage(teacher);
  // No "can you teach at all?" check: everyone can. What the tag changes is
  // the threshold and whether a Routine is owed, both handled elsewhere.
  if (!tag) return "Unknown skill.";
  // Whether the pair can do THIS skill is not checked here: its refusal would
  // name what the other sheet holds. The callers check their own side.
  for (const who of checkSlotsFor) {
    const slot =
      who === teacher.id
        ? await teacherSlot(db, teacher, turnId, { excludeOfferId })
        : await learnerSlot(db, learner, turnId);
    if (!slot.ok) return slot.reason;
  }
  return null;
}

async function loadCharacter(db, id) {
  if (!id) return null;
  return db.character.findUnique({
    where: { id },
    select: LESSON_CHARACTER_SELECT,
  });
}

// --- the offer -------------------------------------------------------------

// Files a PENDING offer and returns the DM to send the responder. The
// initiator is whichever side pressed the button; the other side answers.
// Returns { ok: true, offer, dm: { discordUserId, content, components } } or
// { ok: false, reason }.
async function createLessonOffer(
  prisma,
  { initiatorId, teacherId, learnerId, tagId },
) {
  const { turn, locked, blocked } = await openTurnAndWindow(prisma);
  if (!turn) return { ok: false, reason: "No turn is open." };
  if (locked) return { ok: false, reason: blocked };

  const [teacher, learner, tag] = await Promise.all([
    loadCharacter(prisma, teacherId),
    loadCharacter(prisma, learnerId),
    tagId
      ? prisma.tag.findUnique({
          where: { id: tagId },
          select: LESSON_CATALOG_SELECT,
        })
      : null,
  ]);
  if (initiatorId !== teacherId && initiatorId !== learnerId)
    return { ok: false, reason: "That isn't your lesson." };

  const problem = await validateLesson(prisma, {
    teacher,
    learner,
    tag,
    turnId: turn.id,
    checkSlotsFor: [initiatorId],
  });
  if (problem) return { ok: false, reason: problem };

  // Only the initiator's own side can refuse here. The other side's is never
  // told to the initiator — the offer goes out regardless, and a teacher who
  // doesn't know it can only decline, which reads like any other decline.
  const catalog = await prisma.tag.findMany({ select: LESSON_CATALOG_SELECT });
  const teacherKnows = knownTeachableSkills(teacher, catalog).some((t) => t.id === tag.id);
  if (initiatorId === learnerId && !learnableSkills(learner, catalog).some((t) => t.id === tag.id))
    return { ok: false, reason: `You can't learn ${tag.name} right now.` };
  if (initiatorId === teacherId && !teacherKnows)
    return { ok: false, reason: `You don't know ${tag.name}.` };

  const responder = initiatorId === teacherId ? learner : teacher;
  if (!responder.discordUserId)
    return { ok: false, reason: `${responder.name} can't be reached.` };

  const duplicate = await prisma.offer.findFirst({
    where: {
      kind: "LESSON",
      status: "PENDING",
      turnId: turn.id,
      teacherId,
      learnerId,
      tagId,
    },
    select: { id: true },
  });
  if (duplicate)
    return {
      ok: false,
      reason: "That offer is already waiting on an answer.",
    };

  const offer = await prisma.offer.create({
    data: {
      kind: "LESSON",
      turnId: turn.id,
      initiatorId,
      responderId: responder.id,
      teacherId,
      learnerId,
      tagId,
    },
  });

  const content =
    initiatorId === learnerId
      ? // Bascinet's line.
        teacherKnows
        ? `*${learner.name}* wants to try and learn *${tag.name}* from you. Accept?`
        : `*${learner.name}* wants to try and learn *${tag.name}* from you. You don't know it.`
      : `*${teacher.name}* offers to teach you *${tag.name}*. Accept?`;
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: responder.discordUserId,
      content,
      components: offerButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id),
    },
  };
}

// --- accepting -------------------------------------------------------------

function confirmLines(action) {
  return action.moveKind === "GAMBIT"
    ? [
        `» ${action.description}`,
        "Kind: **Gambit**",
        "🎲 *The die is cast. You'll see how it fell when the turn ends.*",
        "» *Locked in. Results land when the turn ends.*",
      ].join("\n")
    : [
        `» ${action.description}`,
        "Kind: **Routine**",
        "» *Locked in. Results land when the turn ends.*",
      ].join("\n");
}

// Claims the offer and files both Moves in one transaction. Returns
// { ok: true, dms: [{ discordUserId, content }], line } — `line` is what the
// responder's own DM gets edited to say — or { ok: false, reason }.
//
// Order matters. A stale click (the offer already ACCEPTED, DECLINED or
// EXPIRED) is answered "gone" before anything else is looked at: the checks
// below would otherwise see the teacher's own lesson Routine as "no room"
// and cancel a lesson that was already under way. A failure BEFORE the claim
// cancels the offer only while it is still PENDING; a failure AFTER the
// claim is the claimant's own and cancels the ACCEPTED row it just made.
// Did the lesson take? The pure half, so every branch is testable without a database —
// the same split db/lib/torture.js and db/lib/breakRestraints.js use.
// A dead learner never learns, whatever the die said: the roll is thrown when the offer is
// accepted, and somebody can be killed between the offer and the answer.
function lessonOutcome({ die, diceModifier = 0, charmBonus = 0, threshold, learnerStatus }) {
  const total = (die ?? 0) + diceModifier + charmBonus;
  return { total, succeeded: learnerStatus === "ALIVE" && total >= threshold };
}

async function acceptLesson(prisma, offer, responder) {
  const fresh = await prisma.offer.findUnique({ where: { id: offer.id } });
  if (!fresh || fresh.status !== "PENDING")
    return { ok: false, reason: GONE, dms: [] };

  const { turn, locked, blocked } = await openTurnAndWindow(prisma);
  if (!turn || turn.id !== offer.turnId)
    return await cancelWith(
      prisma,
      offer,
      "That offer was for a turn that's over.",
    );
  if (locked) return await cancelWith(prisma, offer, blocked);

  const [teacher, learner, tag] = await Promise.all([
    loadCharacter(prisma, offer.teacherId),
    loadCharacter(prisma, offer.learnerId),
    offer.tagId
      ? prisma.tag.findUnique({
          where: { id: offer.tagId },
          select: LESSON_CATALOG_SELECT,
        })
      : null,
  ]);
  // The pair can't do this skill (the teacher never knew it, or the learner
  // can't take it): answered as a plain decline, so the initiator learns
  // nothing about the other sheet they wouldn't from a "no".
  if (teacher && learner && tag) {
    const catalog = await prisma.tag.findMany({ select: LESSON_CATALOG_SELECT });
    if (!teachableSkills(teacher, learner, catalog).some((t) => t.id === tag.id))
      return declineOffer(prisma, offer, responder);
  }

  const problem = await validateLesson(prisma, {
    teacher,
    learner,
    tag,
    turnId: turn.id,
    checkSlotsFor: [teacher?.id, learner?.id].filter(Boolean),
  });
  if (problem) return await cancelWith(prisma, offer, problem);

  const threshold = lessonThreshold(teacher, tag);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The claim: PENDING -> ACCEPTED, or someone else already answered.
      const claim = await tx.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      if (claim.count === 0) return { ok: false, reason: GONE };

      // The learner's Gambit. @@unique([characterId, turnId]) is the real
      // gate; the slot checks above were the polite version.
      // Lucky or Inspired keeps the better of two dice (db/lib/advantage.js);
      // Inspired is spent the instant it wins one.
      const learnerAdvantage = rollWithAdvantage(learner.tags, 6);
      const diceModifier = gambitModifierTotal(learner.tags, { mood: learner.mood });

      // The Minted Charm (docs/tags.yaml): +1 to the wearer's Learn roll while EQUIPPED —
      // the student-side sibling of Teaching (Drill Instructor), which moves the threshold
      // from the teacher's side instead. Read now rather than at turn end, because now is
      // when the lesson happens.
      const charm = await tx.characterTag.findFirst({
        where: { characterId: learner.id, equipped: true, tag: { slug: "minted-charm" } },
        select: { id: true },
      });
      const charmBonus = charm ? 1 : 0;
      const { text: rollText } = rollLine(turn, { diceRoll: learnerAdvantage.die, diceModifier }, charmBonus);
      const { total, succeeded } = lessonOutcome({
        die: learnerAdvantage.die,
        diceModifier,
        charmBonus,
        threshold,
        learnerStatus: learner.status,
      });

      // The grant, here and not in a pass. `already` keeps a repeat lesson from stacking a
      // skill somebody already has, exactly as the turn-end pass did.
      let replaced = [];
      if (succeeded) {
        const already = await tx.characterTag.findUnique({
          where: { characterId_tagId: { characterId: learner.id, tagId: tag.id } },
        });
        if (!already) {
          replaced = await replaceLowerTiers(tx, learner.id, tag.id);
          await addToStack(tx, learner.id, tag.id, 1, { source: "LESSON" });
        }
      }

      const resultMessage = succeeded
        ? `Learned ${tag.name} from ${teacher.name} (${total} vs ${threshold}).`
        : `Failed to learn ${tag.name} from ${teacher.name} (${total} vs ${threshold}).`;

      // PASSED and appliedEffects {}, so this never reaches the adjudication desk and the
      // staged push skips it. It stays a GAMBIT because a die really was thrown — the desk
      // draws it as "Lesson (auto)" (web/lib/moves.js) — but there is nothing left to judge.
      const learnerAction = await tx.action.create({
        data: {
          characterId: learner.id,
          turnId: turn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "PASSED",
          reviewedAt: new Date(),
          resultMessage,
          appliedEffects: {},
          description: `Learning ${tag.name} from ${teacher.name}.`,
          diceRoll: learnerAdvantage.die,
          diceModifier,
          zoneId: learner.zoneId ?? null,
          gmNotes: "auto:lesson",
        },
      });

      // The teacher's Routine — owed only by a teacher without the tag. A
      // Teaching holder files nothing, so the offer's teacherActionId stays
      // null and there is no Move for a GM to reject or for the desk to show.
      const slot = await teacherSlot(tx, teacher, turn.id, {
        excludeOfferId: offer.id,
      });
      if (!slot.ok) throw new LessonRefused(slot.reason);
      let teacherAction = null;
      if (!slot.free) {
        teacherAction = await tx.action.create({
          data: {
            characterId: teacher.id,
            turnId: turn.id,
            type: "MOVE",
            status: "CONFIRMED",
            confirmedAt: new Date(),
            moveKind: "ROUTINE",
            moveReviewStatus: "PASSED",
            description: `Teaching ${tag.name} to ${learner.name}.`,
            appliedEffects: {},
            zoneId: teacher.zoneId ?? null,
            gmNotes: "auto:lesson",
          },
        });
      }

      await tx.offer.update({
        where: { id: offer.id },
        data: {
          threshold,
          learnerActionId: learnerAction.id,
          teacherActionId: teacherAction?.id ?? null,
          // RESOLVED here, not ACCEPTED: there is no later pass to come looking.
          status: "RESOLVED",
          resolvedAt: new Date(),
          outcome: {
            diceRoll: learnerAdvantage.die,
            diceModifier,
            charmBonus,
            total,
            threshold,
            succeeded,
            replaced,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: responder.discordUserId ?? "system",
          actionType: "lesson_accepted",
          targetCharacterId: learner.id,
          details: {
            offerId: offer.id,
            teacherId: teacher.id,
            teacherName: teacher.name,
            learnerId: learner.id,
            learnerName: learner.name,
            tagId: tag.id,
            tagName: tag.name,
            threshold,
            learnerActionId: learnerAction.id,
            teacherActionId: teacherAction?.id ?? null,
          },
        },
      });

      return { ok: true, learnerAction, teacherAction, rollText, succeeded };
    });
    if (!result.ok) return result;

    const learnerLines = confirmLines(result.learnerAction);
    // A teacher who spent nothing has no Move to confirm, so they get a line of
    // their own instead of a Move block. [PLAYER TEXT — Bascinet to rewrite]
    const teacherLines = result.teacherAction
      ? confirmLines(result.teacherAction)
      : `» *Teaching ${tag.name} to ${learner.name}. It costs you no Move.*`;
    const responderIsLearner = responder.id === learner.id;

    // The lesson is over before this returns, so both people hear how it went now rather
    // than at dawn. [PLAYER TEXT — Bascinet to rewrite]
    const learnerOutcome = result.succeeded
      ? `${result.rollText} → you learned **${tag.name}** from ${teacher.name}.`
      : `${result.rollText} → you didn't learn **${tag.name}** this time.`;
    const teacherOutcome = result.succeeded
      ? `${learner.name} picked up **${tag.name}**.`
      : `${learner.name} didn't learn **${tag.name}**.`;

    const dms = [];
    // The person who did NOT press the button is told the offer was answered AND how it
    // turned out, in one DM rather than two.
    if (responderIsLearner && teacher.discordUserId) {
      dms.push({
        discordUserId: teacher.discordUserId,
        content: `${learner.name} accepted.\n${teacherLines}\n${teacherOutcome}`,
      });
    }
    if (!responderIsLearner && learner.discordUserId) {
      dms.push({
        discordUserId: learner.discordUserId,
        content: `${teacher.name} accepted.\n${learnerLines}\n${learnerOutcome}`,
      });
    }

    return {
      ok: true,
      line: responderIsLearner
        ? `${learnerLines}\n${learnerOutcome}`
        : `${teacherLines}\n${teacherOutcome}`,
      dms,
    };
  } catch (err) {
    if (err instanceof LessonRefused)
      return await cancelWith(prisma, offer, err.message, { claimed: true });
    if (err?.code === "P2002")
      return await cancelWith(prisma, offer, LOCKED_IN, { claimed: true });
    throw err;
  }
}

class LessonRefused extends Error {}

// Marks the offer CANCELLED and hands back the reason plus a DM for the
// initiator, so a refusal at accept time doesn't leave them waiting on an
// answer that already came. Before the claim only a PENDING row may be
// cancelled — a concurrent click that already accepted must not be undone
// by a slower one. `claimed` is the claimant's own post-claim failure.
async function cancelWith(prisma, offer, reason, { claimed = false } = {}) {
  await prisma.offer.updateMany({
    where: { id: offer.id, status: claimed ? "ACCEPTED" : "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  const initiator = await prisma.character.findUnique({
    where: { id: offer.initiatorId },
    select: { discordUserId: true },
  });
  return {
    ok: false,
    reason,
    dms: initiator?.discordUserId
      ? [
          {
            discordUserId: initiator.discordUserId,
            content: `Your offer fell through: ${reason}`,
          },
        ]
      : [],
  };
}

// --- declining -------------------------------------------------------------

async function declineOffer(prisma, offer, responder) {
  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: GONE, dms: [] };
  const initiator = await prisma.character.findUnique({
    where: { id: offer.initiatorId },
    select: { discordUserId: true },
  });
  // Search is the one kind whose responder may be wearing a hood, so it is the
  // one whose refusal cannot use the bare row name — that would hand the
  // searcher the identity the hood is bought to keep (INTERCEPT.md §2). Every
  // other kind refuses a covered face at the gate, so `responder.name` is
  // already the face that was seen.
  let refusedBy = responder.name;
  if (offer.kind === "SEARCH") {
    const { seenAs, identityOf, IDENTITY_SELECT } = require("./intercept");
    const { capitalizeFirst } = require("./concealedIdentity");
    const row = await prisma.character.findUnique({
      where: { id: offer.responderId },
      select: IDENTITY_SELECT,
    });
    refusedBy = capitalizeFirst(seenAs(identityOf(row)));
  }

  // Per kind, because "you passed on the lesson" is a strange thing to read
  // after refusing to be tied up or to be led away.
  const WORDING = {
    BIND: { content: `${responder.name} won't be bound.`, line: "You said no." },
    ESCORT: {
      content: `${responder.name} isn't coming with you.`,
      line: "You stay where you are.",
    },
    KISS: {
      content: `${responder.name} turned you down.`,
      line: "You said no.",
    },
    SEARCH: {
      content: `${refusedBy} refused your search.`,
      line: "You said no.",
    },
  };
  const wording = WORDING[offer.kind] ?? {
    content: `${responder.name} declined the lesson.`,
    line: "You rejected the lesson.",
  };
  return {
    ok: true,
    line: wording.line,
    dms: initiator?.discordUserId
      ? [{ discordUserId: initiator.discordUserId, content: wording.content }]
      : [],
  };
}

// --- cancellation hooks ------------------------------------------------------

// A GM rejected (deleted) an Action. A learner's Gambit going means the
// lesson is off; a teacher's Routine going takes every lesson on it, and the
// learners' Gambits with it — they can't learn from nobody. Returns the DMs
// owed. Runs inside the caller's transaction, BEFORE the Action row is deleted.
async function cancelOffersForAction(tx, actionId) {
  const offers = await tx.offer.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ learnerActionId: actionId }, { teacherActionId: actionId }],
    },
  });
  const dms = [];
  for (const offer of offers) {
    await tx.offer.update({
      where: { id: offer.id },
      data: {
        status: "CANCELLED",
        resolvedAt: new Date(),
        outcome: { cancelledBy: "gm_reject" },
      },
    });
    if (offer.teacherActionId === actionId && offer.learnerActionId) {
      // The learner's Gambit has no lesson behind it any more.
      await tx.action.deleteMany({ where: { id: offer.learnerActionId } });
      const learner = await tx.character.findUnique({
        where: { id: offer.learnerId },
        select: { discordUserId: true },
      });
      const teacher = await tx.character.findUnique({
        where: { id: offer.teacherId },
        select: { name: true },
      });
      if (learner?.discordUserId) {
        // This hook is shared with Confession, whose "teacher" is a chaplain.
        const what = offer.kind === "CONFESSION" ? "confession" : "lesson";
        const who =
          teacher?.name ??
          (offer.kind === "CONFESSION" ? "your chaplain" : "your teacher");
        dms.push({
          discordUserId: learner.discordUserId,
          content: `Your ${what} with ${who} was called off by a GM. Your Move wasn't spent.`,
        });
      }
    }
  }
  return dms;
}

// Death: a PENDING offer either way is void. An ACCEPTED lesson still
// resolves — it happened when it was accepted.
async function cancelOffersForCharacter(db, characterId) {
  await db.offer.updateMany({
    where: {
      status: "PENDING",
      OR: [{ initiatorId: characterId }, { responderId: characterId }],
    },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
}

module.exports = {
  lessonOutcome,
  LESSON_CATALOG_SELECT,
  teachableSkills,
  learnableSkills,
  knownTeachableSkills,
  teachesFree,
  lessonThreshold,
  createLessonOffer,
  acceptLesson,
  declineOffer,
  cancelOffersForAction,
  cancelOffersForCharacter,
};
