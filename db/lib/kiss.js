// Kissing (docs/systemdocs/KISS.md).
//
// The one kind thing a character can do to another. Everything else that
// lifts a mood is something you buy or build — a drink, a meal, a roof, a
// confession, music. This lifts it because somebody agreed.
//
// A kiss is an Offer, the same consent handshake Lesson, Bind, Confession and
// Escort already share: the web files a PENDING row, the other player gets a
// DM with Accept / Decline, and nothing happens until they press one. The bot
// needs no new branch — db/lib/offerRow.js owns the button prefixes and
// bot/src/lib/offers.js reads the kind off the row.
//
// What it costs: nothing. No Move, no Action row, no die, no turn pass. The
// two things that hold it back are a 2-hour cooldown on ASKING (here) and a
// once-a-turn ration on the mood itself (db/lib/mood.js#applyKissMood). Both
// are AuditLog reads on purpose — neither needed a column.
//
// Takes `prisma` as the first parameter and is NOT on the @lifeweb/db barrel;
// require it by path, the db/lib/dm.js convention.
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { blockerFor, KISS } = require("./incapacitation");
const { KISS_BLOCKING_SLUGS } = require("./constants");
const { concealmentFrom, CONCEALMENT_TAG_FIELDS } = require("./presentedIdentity");
const { applyKissMood } = require("./mood");

// Two hours, the same clock db/lib/webOnly.js runs on. It is spent by the
// ASK, not by the answer: a decline does not refund it, which is the whole
// reason it exists — otherwise asking a whole room costs nothing and the
// picker becomes a way to find out who is willing.
const KISS_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// TWO audit actions, and keeping them apart is load-bearing. "kiss" is the ASK
// and nothing else, which is what makes it usable as the cooldown clock below.
// If the accept wrote "kiss" rows too, then being kissed would start a
// two-hour wall on the person who was asked — punishing them for saying yes.
const KISS_AUDIT_ACTION = "kiss";
const KISS_ACCEPTED_ACTION = "kiss_accepted";

// Everything kissAuthority reads. `equipped` and CONCEALMENT_TAG_FIELDS are
// what makes the covered-face rule work: concealmentFrom() only counts a piece
// somebody is actually WEARING, and a row loaded without them would quietly
// report every hood as no hood at all.
const KISS_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  concealed: true,
  buriedAt: true,
  discordUserId: true,
  updatedAt: true,
  age: true,
  gender: true,
  tags: {
    select: {
      equipped: true,
      tag: { select: { slug: true, name: true, ...CONCEALMENT_TAG_FIELDS } },
    },
  },
};

// Why this character cannot kiss anybody, or null. `self` picks the person the
// sentence is about, so the same three checks answer for both sides.
//
// The refusal NAMES the tag, the blockerFor() habit: "You're Bound." beats
// "You can't do that", and a player who cannot see why they were refused opens
// a GM ticket about it.
function kissBlock(character, { self }) {
  const who = self ? "You're" : `${character.name} is`;

  // The capability table first (db/lib/incapacitation.js). Everything that
  // blocks ACT blocks KISS through it — bound, dying, unconscious, crucified —
  // which is what makes "a kiss needs somebody who can answer" fall out of one
  // table rather than a second list kept beside it.
  const blocker = blockerFor(character.tags, KISS);
  if (blocker) return `${who} ${blocker.name}.`;

  // Then the short hand-written list of things that are not an incapacity at
  // all — a Ghoul walks and works and still is not kissing anyone.
  const held = new Set((character.tags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
  const fiction = KISS_BLOCKING_SLUGS.find((slug) => held.has(slug));
  if (fiction) {
    const row = (character.tags ?? []).find((ct) => (ct?.tag?.slug ?? ct?.slug) === fiction);
    return `${who} ${row?.tag?.name ?? row?.name ?? fiction}.`;
  }

  // A covered face, derived rather than listed: every helm, mask, hood and the
  // bag sets concealsIdentity, and so will anything added to the catalog
  // later. This is also the honest half of "you can't kiss a concealed
  // person" — presence.js filters the /conceal WISH column, which a
  // forcesConceal helmet never touches.
  const piece = concealmentFrom(character.tags);
  if (piece)
    return self
      ? `You can't kiss when you have a ${piece.name} on.`
      : `${character.name} can't kiss when they have a ${piece.name} on.`;

  return null;
}

// May these two kiss right now? Returns null when they may, or the one
// sentence to refuse with. Both rows are KISS_SELECT.
//
// Run at ASK time and again at ACCEPT time — a DM can sit unanswered for
// hours, and in that time either of them can be bound, hooded, or killed.
function kissAuthority(actor, target) {
  if (!actor || !target) return "They aren't here.";
  if (actor.id === target.id) return "Kiss somebody else.";
  if (actor.status !== "ALIVE") return "You can't do that right now.";
  if (target.status !== "ALIVE") return notHereMessage(target);
  if (!isHere(actor, target)) return notHereMessage(target);
  return kissBlock(actor, { self: true }) ?? kissBlock(target, { self: false });
}

// How long until this character may ask again, in ms, or 0. The audit row the
// last ask already wrote IS the clock — there is no column, the same shape
// db/lib/shout.js's throat cooldown uses.
//
// Keyed on the ASKER's Discord id (the indexed column), because the row's
// targetCharacterId is the person who was asked. A character with no Discord
// id has never asked for anything, so the cooldown reads clear.
async function kissCooldownLeft(prisma, discordUserId) {
  if (!discordUserId) return 0;
  const last = await prisma.auditLog
    .findFirst({
      where: { actionType: KISS_AUDIT_ACTION, actorDiscordUserId: discordUserId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    .catch(() => null);
  const since = Date.now() - (last?.createdAt?.getTime?.() ?? 0);
  return since < KISS_COOLDOWN_MS ? KISS_COOLDOWN_MS - since : 0;
}

// Files the consent offer. Returns { ok, offer, dm } or { ok: false, reason }.
// Mirrors db/lib/bind.js#createBindOffer, which is the same shape of ask.
async function createKissOffer(prisma, { actor, target, turn }) {
  const refusal = kissAuthority(actor, target);
  if (refusal) return { ok: false, reason: refusal };
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };

  const duplicate = await prisma.offer.findFirst({
    where: { kind: "KISS", status: "PENDING", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "You've already asked." };

  // The cooldown is checked AFTER the duplicate guard so asking the same
  // person twice reads as "you've already asked" rather than as a two-hour
  // wall the player cannot see the reason for.
  const left = await kissCooldownLeft(prisma, actor.discordUserId);
  if (left > 0) {
    const minutes = Math.max(1, Math.ceil(left / 60_000));
    return { ok: false, reason: `Not for another ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  // The offer and the clock in ONE transaction. The audit row IS the cooldown
  // (kissCooldownLeft reads it), so writing it here rather than leaving it to
  // the caller is what makes the two hours real: a caller that forgot would
  // silently have no cooldown at all, and a check in one statement with the
  // spend in another lets two fast clicks both pass.
  const offer = await prisma.$transaction(async (tx) => {
    const row = await tx.offer.create({
      data: { kind: "KISS", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
    });
    if (actor.discordUserId) {
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: actor.discordUserId,
          actionType: KISS_AUDIT_ACTION,
          targetCharacterId: target.id,
          turnId: turn.id,
          details: { offerId: row.id, targetName: target.name, asked: true },
        },
      });
    }
    return row;
  });
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: target.discordUserId,
      content: `*${actor.name}* would like to kiss you.`,
      components: offerButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id),
    },
  };
}

// The Accept click. Returns { ok, line, dms } or { ok: false, reason, dms },
// the shape db/lib/dmAnswer.js#answerOffer hands back to both faces.
async function acceptKiss(prisma, offer, responder) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  const [actor, target] = await Promise.all([
    prisma.character.findUnique({ where: { id: offer.initiatorId }, select: KISS_SELECT }),
    prisma.character.findUnique({ where: { id: offer.responderId }, select: KISS_SELECT }),
  ]);

  const refuse = async (reason) => {
    await prisma.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    return {
      ok: false,
      reason,
      dms: actor?.discordUserId
        ? [{ discordUserId: actor.discordUserId, content: `Your offer fell through: ${reason}` }]
        : [],
    };
  };

  // Re-run the whole gate. A DM can sit unanswered for hours, and in that time
  // either of them can be bound, hooded, drugged or killed.
  const refusal = kissAuthority(actor, target);
  if (refusal) return refuse(refusal);

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  // Both dials and both audit rows in one transaction; the scene line is a
  // network call and stays outside it.
  const moved = await prisma.$transaction(async (tx) => {
    const [a, b] = await Promise.all([
      applyKissMood(tx, actor.id, { turnId: turn?.id ?? null, partnerId: target.id }),
      applyKissMood(tx, target.id, { turnId: turn?.id ?? null, partnerId: actor.id }),
    ]);
    // One row per side, and both carry turnId — REQUESTS.md §1a. It costs
    // nothing now and it is the only thing that lets a ration ever count them.
    await tx.auditLog.createMany({
      data: [
        {
          actorDiscordUserId: actor.discordUserId ?? "system",
          actionType: KISS_ACCEPTED_ACTION,
          targetCharacterId: target.id,
          turnId: turn?.id ?? null,
          details: { offerId: offer.id, initiator: actor.name, responder: target.name, moodApplied: Boolean(a) },
        },
        {
          actorDiscordUserId: target.discordUserId ?? "system",
          actionType: KISS_ACCEPTED_ACTION,
          targetCharacterId: actor.id,
          turnId: turn?.id ?? null,
          details: { offerId: offer.id, initiator: actor.name, responder: target.name, moodApplied: Boolean(b) },
        },
      ],
    });
    return { actorMoved: Boolean(a), targetMoved: Boolean(b) };
  });

  await prisma.offer.update({
    where: { id: offer.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), outcome: { kissed: true, ...moved } },
  });

  return {
    ok: true,
    line: `You kissed ${target.name}.`,
    dms: actor.discordUserId
      ? [{ discordUserId: actor.discordUserId, content: `${target.name} kissed you back.` }]
      : [],
  };
}

// Nothing is said in the room, the Location, the feed or the archive. A kiss
// is private: the only two people told are the two people who agreed to it,
// each by DM. There WAS a `-# Ada and Celeste kissed.` line here, posted into
// whichever room or Location the two shared — it went out on 2026-09-10 and
// the lines it had already written were deleted from the live game with it.
//
// Bascinet's call, and it is the reason `presentedIdentity` no longer appears
// in this file: with no line to write, there is no name to present.

module.exports = {
  KISS_COOLDOWN_MS,
  KISS_AUDIT_ACTION,
  KISS_ACCEPTED_ACTION,
  KISS_SELECT,
  kissBlock,
  kissAuthority,
  kissCooldownLeft,
  createKissOffer,
  acceptKiss,
};
