// Confession: the Confess handshake (docs/systemdocs/CONFESSION.md). An Offer
// of kind CONFESSION between a penitent and a chaplain over one of the
// penitent's `psychological` tags. Only the PENITENT ever starts one — no
// chaplain "hear confession" menu, and the Accept DM the chaplain gets NEVER
// NAMES THE TAG; they agree to hear a confession, not that one. Accepting
// files both Moves for the turn (penitent's Gambit, chaplain's Routine);
// db/lib/confessionPass.js rolls it at turn end. Structurally this is
// db/lib/lessons.js with the teacher's menu amputated — read LESSONS.md
// first. Takes `prisma` as the first parameter; NOT on the @lifeweb/db
// barrel, require it by path.
const { rollWithAdvantage } = require("./advantage");
const { gambitModifierTotal } = require("./gambitModifier");
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { CHAPLAIN_SLUG, CONFESSION_THRESHOLD, GUILT_RIDDEN_SLUG } = require("./constants");
const { movesOpen } = require("./turnGate");

// mood feeds the penitent's Gambit modifier, same as a hand-filed Gambit
// (Hunger comes off held tags instead, already part of `tags` below).
const CONFESSION_CHARACTER_SELECT = {
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
      tag: {
        // gambitBonus: read back by db/lib/gambitModifier.js below.
        select: { id: true, slug: true, name: true, psychological: true, gambitBonus: true },
      },
    },
  },
};

// --- eligibility ---------------------------------------------------------

function heldSlugs(character) {
  return new Set(
    (character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
  );
}

// Bishop and Chaplain both hold the tag; neither role is checked here.
function isChaplain(character) {
  return heldSlugs(character).has(CHAPLAIN_SLUG);
}

// The penitent's confessable tags: those flagged `psychological` in docs/tags.yaml.
// Takes one character — unlike teachableSkills, nothing about the chaplain narrows this.
function confessableTags(penitent) {
  // Guilt Ridden: someone drowning in guilt can't name any one sin, so the list is empty.
  if (heldSlugs(penitent).has(GUILT_RIDDEN_SLUG)) return [];
  return (penitent?.tags ?? [])
    .map((ct) => ct.tag)
    .filter((tag) => tag?.psychological)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- shared checks -------------------------------------------------------

const GONE = "That confession's gone.";
const LOCKED_IN = "You've already locked in a Move this turn.";

// A thin shim over db/lib/turnGate.js#movesOpen, kept only because both call sites here want the turn row back as well as
// the verdict. `blocked` is the reason to say out loud, null when the player may act — which covers the lock AND the game
// being out of session, two things this used to have no way to tell apart.
async function openTurnAndWindow(db) {
  const gate = await movesOpen(db);
  return { turn: gate.turn, locked: !gate.ok, blocked: gate.message };
}

// One confession is one whole Routine, always — a chaplain hears one person a
// day, and unlike teaching there is no tag that buys the Move back.
async function freeSlot(db, character, turnId) {
  const action = await db.action.findFirst({
    where: { characterId: character.id, turnId },
    select: { id: true },
  });
  return action
    ? {
        ok: false,
        reason: `${character.name} has already locked in a Move this turn.`,
      }
    : { ok: true };
}

// Checked the same way at offer time and accept time. `checkSlotsFor` is the
// penitent alone at offer time and both at accept time.
async function validateConfession(
  db,
  { chaplain, penitent, tag, turnId, checkSlotsFor },
) {
  if (!chaplain || chaplain.status !== "ALIVE")
    return "That chaplain isn't around any more.";
  if (!penitent || penitent.status !== "ALIVE")
    return "That penitent isn't around any more.";
  if (heldSlugs(penitent).has(GUILT_RIDDEN_SLUG))
    return "You can't bring yourself to confess.";
  if (chaplain.id === penitent.id) return "You can't confess to yourself.";
  // allowConcealed both ways. A confessional is a box built so neither side
  // sees the other, so a hood is if anything the point — and the chaplain is
  // never shown the sin regardless (CONFESSION.md).
  if (!isHere(chaplain, penitent, { allowConcealed: true })) return notHereMessage(penitent);
  if (!isHere(penitent, chaplain, { allowConcealed: true })) return notHereMessage(chaplain);
  if (!isChaplain(chaplain))
    return `${chaplain.name} can't take a confession.`;
  if (!tag) return "Unknown burden.";
  // Re-derived from the penitent's own row, never trusted from the client.
  if (!confessableTags(penitent).some((t) => t.id === tag.id)) {
    return `That isn't something ${penitent.name} can confess.`;
  }
  for (const who of checkSlotsFor) {
    const slot = await freeSlot(
      db,
      who === chaplain.id ? chaplain : penitent,
      turnId,
    );
    if (!slot.ok) return slot.reason;
  }
  return null;
}

async function loadCharacter(db, id) {
  if (!id) return null;
  return db.character.findUnique({
    where: { id },
    select: CONFESSION_CHARACTER_SELECT,
  });
}

// --- the offer -------------------------------------------------------------

// Files a PENDING offer and returns the DM to send the chaplain.
// `initiatorId` is always the penitent — the chaplain has no door into this function.
async function createConfessionOffer(
  prisma,
  { penitentId, chaplainId, tagId },
) {
  const { turn, locked, blocked } = await openTurnAndWindow(prisma);
  if (!turn) return { ok: false, reason: "No turn is open." };
  if (locked) return { ok: false, reason: blocked };

  const [chaplain, penitent, tag] = await Promise.all([
    loadCharacter(prisma, chaplainId),
    loadCharacter(prisma, penitentId),
    tagId
      ? prisma.tag.findUnique({
          where: { id: tagId },
          select: { id: true, name: true, psychological: true },
        })
      : null,
  ]);

  const problem = await validateConfession(prisma, {
    chaplain,
    penitent,
    tag,
    turnId: turn.id,
    checkSlotsFor: [penitentId],
  });
  if (problem) return { ok: false, reason: problem };

  if (!chaplain.discordUserId)
    return { ok: false, reason: `${chaplain.name} can't be reached.` };

  const duplicate = await prisma.offer.findFirst({
    where: {
      kind: "CONFESSION",
      status: "PENDING",
      turnId: turn.id,
      learnerId: penitentId,
      teacherId: chaplainId,
    },
    select: { id: true },
  });
  if (duplicate)
    return {
      ok: false,
      reason: "That confession is already waiting on an answer.",
    };

  const offer = await prisma.offer.create({
    data: {
      kind: "CONFESSION",
      turnId: turn.id,
      initiatorId: penitentId,
      responderId: chaplainId,
      // Chaplain in teacherId, penitent in learnerId, so Routine/Gambit line up with Lesson columns.
      teacherId: chaplainId,
      learnerId: penitentId,
      tagId,
    },
  });

  // Tag deliberately absent: naming it would put the sin in the chaplain's DMs before they agreed.
  const content = `*${penitent.name}* wants to confess to you. Accept?`;
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: chaplain.discordUserId,
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

class ConfessionRefused extends Error {}

// Claims the offer and files both Moves in one transaction. `line` is what
// the chaplain's own DM gets edited to say. Same ordering rule as
// acceptLesson: a stale click is answered "gone" before anything else.
async function acceptConfession(prisma, offer, responder) {
  const fresh = await prisma.offer.findUnique({ where: { id: offer.id } });
  if (!fresh || fresh.status !== "PENDING")
    return { ok: false, reason: GONE, dms: [] };

  const { turn, locked, blocked } = await openTurnAndWindow(prisma);
  if (!turn || turn.id !== offer.turnId) {
    return await cancelWith(
      prisma,
      offer,
      "That confession was for a turn that's over.",
    );
  }
  if (locked) return await cancelWith(prisma, offer, blocked);

  const [chaplain, penitent, tag] = await Promise.all([
    loadCharacter(prisma, offer.teacherId),
    loadCharacter(prisma, offer.learnerId),
    offer.tagId
      ? prisma.tag.findUnique({
          where: { id: offer.tagId },
          select: { id: true, name: true, psychological: true },
        })
      : null,
  ]);
  const problem = await validateConfession(prisma, {
    chaplain,
    penitent,
    tag,
    turnId: turn.id,
    checkSlotsFor: [chaplain?.id, penitent?.id].filter(Boolean),
  });
  if (problem) return await cancelWith(prisma, offer, problem);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      if (claim.count === 0) return { ok: false, reason: GONE };

      // Penitent's Gambit. @@unique([characterId, turnId]) is the real gate; slot checks above were
      // the polite version. Lucky/Inspired keeps the better of two dice (db/lib/advantage.js);
      // Inspired is spent the instant it wins one.
      const penitentAdvantage = rollWithAdvantage(penitent.tags, 6);
      const penitentAction = await tx.action.create({
        data: {
          characterId: penitent.id,
          turnId: turn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "GAMBIT",
          moveReviewStatus: "OPEN",
          description: `Confessing ${tag.name} to ${chaplain.name}.`,
          diceRoll: penitentAdvantage.die,
          diceModifier: gambitModifierTotal(penitent.tags, { mood: penitent.mood }),
          zoneId: penitent.zoneId ?? null,
          gmNotes: "auto:confession",
        },
      });

      // Chaplain's Routine: description names the penitent but NOT the tag — it reaches their own DM.
      const chaplainAction = await tx.action.create({
        data: {
          characterId: chaplain.id,
          turnId: turn.id,
          type: "MOVE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          moveKind: "ROUTINE",
          moveReviewStatus: "PASSED",
          description: `Hearing ${penitent.name}'s confession.`,
          appliedEffects: {},
          zoneId: chaplain.zoneId ?? null,
          gmNotes: "auto:confession",
        },
      });

      await tx.offer.update({
        where: { id: offer.id },
        data: {
          threshold: CONFESSION_THRESHOLD,
          learnerActionId: penitentAction.id,
          teacherActionId: chaplainAction.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorDiscordUserId: responder.discordUserId ?? "system",
          actionType: "confession_accepted",
          targetCharacterId: penitent.id,
          details: {
            offerId: offer.id,
            chaplainId: chaplain.id,
            chaplainName: chaplain.name,
            penitentId: penitent.id,
            penitentName: penitent.name,
            tagId: tag.id,
            tagName: tag.name,
            threshold: CONFESSION_THRESHOLD,
            penitentActionId: penitentAction.id,
            chaplainActionId: chaplainAction.id,
          },
        },
      });

      return { ok: true, penitentAction, chaplainAction };
    });
    if (!result.ok) return result;

    return {
      ok: true,
      line: confirmLines(result.chaplainAction),
      dms: [
        {
          discordUserId: penitent.discordUserId,
          content: `${chaplain.name} will hear you.\n${confirmLines(result.penitentAction)}`,
        },
      ].filter((dm) => dm.discordUserId),
    };
  } catch (err) {
    if (err instanceof ConfessionRefused)
      return await cancelWith(prisma, offer, err.message, { claimed: true });
    if (err?.code === "P2002")
      return await cancelWith(prisma, offer, LOCKED_IN, { claimed: true });
    throw err;
  }
}

// Marks the offer CANCELLED and hands back a DM for the penitent. Before the
// claim only a PENDING row may be cancelled; `claimed` is a post-claim
// failure. Same shape as lessons.js#cancelWith.
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
            content: `Your confession fell through: ${reason}`,
          },
        ]
      : [],
  };
}

module.exports = {
  confessableTags,
  createConfessionOffer,
  acceptConfession,
};
