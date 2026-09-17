// Kissing (docs/systemdocs/KISS.md). A kiss is an Offer, the same consent
// handshake Lesson/Bind/Confession/Escort share. Costs nothing — no Move,
// Action row, die or turn pass; held back only by a 2-hour ASK cooldown
// (here) and a once-a-turn mood ration (db/lib/mood.js#applyKissMood), both
// AuditLog reads on purpose, no column. Takes `prisma` first, NOT on the @lifeweb/db barrel — require by path.
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { blockerFor, KISS } = require("./incapacitation");
const { KISS_BLOCKING_SLUGS } = require("./constants");
const { concealmentFrom, CONCEALMENT_TAG_FIELDS } = require("./presentedIdentity");
const { applyKissMood } = require("./mood");

// Same clock as db/lib/discordMirroring.js. Spent by the ASK, not the answer — a decline doesn't refund it, or a whole room could be asked for free.
const KISS_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// Keeping these apart is load-bearing: if accept also wrote "kiss" rows, being kissed would start a two-hour wall on the person who said yes.
const KISS_AUDIT_ACTION = "kiss";
const KISS_ACCEPTED_ACTION = "kiss_accepted";

// What a kisser's looks are worth to the person they kiss, on top of
// EVENTS.KISS. This is a fact about the KISSER paid to the OTHER side — being
// pretty is not something that cheers you up, it is something that cheers up
// whoever you kiss — so acceptKiss crosses the two terms over.
//
// Seductive is the Courtesan's trade and stacks on top of a face rather than
// replacing it; pretty/beautiful are one tier chain (Beautiful carries
// `parentTag: pretty`), so only one of them is ever held. `Math.max` says that
// out loud instead of trusting it: a hand-granted pair would otherwise pay
// twice, and a GM_GRANT walks past the tier rule that keeps them exclusive.
//
// Sizing: EVENTS.KISS is 17 and Ecstatic starts at 64 against a ceiling of 82
// (db/lib/mood.js), so Seductive alone carries anyone at −22 or better into
// Ecstatic and its +1 Gambit. That is the point of the seat, not an accident
// of the numbers.
const KISS_APPEARANCE = Object.freeze({ seductive: 75, beautiful: 12, pretty: 6 });

// A Love Tablet, and the one bonus here that is NOT crossed. Everything in
// the table above is a fact about your face, so it is paid to the person who
// has to look at it; In Love is a fact about the evening, so it is paid to
// both of you and one tablet between two people is enough. Kept out of
// KISS_APPEARANCE on purpose — a row there would be silently crossed like the
// rest, which is exactly the bug this shape prevents.
const IN_LOVE_SLUG = "in-love";
const IN_LOVE_BONUS = 80;

function heldSlugsOf(tags) {
  return new Set((tags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

function appearanceBonus(tags) {
  const held = heldSlugsOf(tags);
  const face = Math.max(
    held.has("beautiful") ? KISS_APPEARANCE.beautiful : 0,
    held.has("pretty") ? KISS_APPEARANCE.pretty : 0,
  );
  return (held.has("seductive") ? KISS_APPEARANCE.seductive : 0) + face;
}

// Paid to BOTH sides if EITHER side holds it, and only once however many
// tablets are in the room.
function inLoveBonus(...tagSets) {
  return tagSets.some((tags) => heldSlugsOf(tags).has(IN_LOVE_SLUG)) ? IN_LOVE_BONUS : 0;
}

// `equipped` and CONCEALMENT_TAG_FIELDS make the covered-face rule work — concealmentFrom() only counts a piece actually WEARING, missing them reports every hood as no hood.
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

// `self` picks the person the sentence is about. Refusal NAMES the tag
// (blockerFor() habit): "You're Bound." beats "You can't do that".
function kissBlock(character, { self }) {
  // Covered face, derived rather than listed — the /conceal WISH column is not
  // it, since a forcesConceal helmet never touches that column.
  //
  // Resolved FIRST, because it decides how everything below is allowed to be
  // worded: a refusal must never be an unmasking. A hood can be posted at this
  // gate now that every picker reaches one, and "Sir Alder is Bound." would hand
  // over the name the helmet was bought to hide. So a concealed subject is
  // "They", always, and the item is never named either — that a mask is what is
  // stopping you is plain enough from looking at them.
  const piece = concealmentFrom(character.tags);
  const who = self ? "You're" : piece ? "They're" : `${character.name} is`;

  // Capability table first (db/lib/incapacitation.js) — everything that blocks ACT blocks KISS through it, one table rather than a second list beside it.
  const blocker = blockerFor(character.tags, KISS);
  if (blocker) return `${who} ${blocker.name}.`;

  const held = new Set((character.tags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
  const fiction = KISS_BLOCKING_SLUGS.find((slug) => held.has(slug));
  if (fiction) {
    const row = (character.tags ?? []).find((ct) => (ct?.tag?.slug ?? ct?.slug) === fiction);
    return `${who} ${row?.tag?.name ?? row?.name ?? fiction}.`;
  }

  if (piece)
    return self
      ? `You can't kiss when you have a ${piece.name} on.`
      : "They have their face covered.";

  return null;
}

// Both rows are KISS_SELECT. Run at ASK and again at ACCEPT — a DM can sit unanswered for hours, in which either can be bound, hooded, or killed.
function kissAuthority(actor, target) {
  if (!actor || !target) return "They aren't here.";
  if (actor.id === target.id) return "Kiss somebody else.";
  if (actor.status !== "ALIVE") return "You can't do that right now.";
  if (target.status !== "ALIVE") return notHereMessage(target);
  // allowConcealed, and it changes nothing in practice: kissBlock below refuses
  // a covered face on either side, so a hood is still told no. It is written
  // this way so the refusal comes from the RULE about mouths rather than from
  // co-presence quietly reporting somebody standing in front of you as absent —
  // and so the day a concealing item leaves the mouth free, this still holds.
  if (!isHere(actor, target, { allowConcealed: true })) return notHereMessage(target);
  return kissBlock(actor, { self: true }) ?? kissBlock(target, { self: false });
}

// The last ask's audit row IS the clock — no column. Keyed on the ASKER's Discord id; no Discord id means never asked, so the cooldown reads clear.
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

// Returns { ok, offer, dm } or { ok: false, reason }. Mirrors db/lib/bind.js#createBindOffer.
async function createKissOffer(prisma, { actor, target, turn }) {
  const refusal = kissAuthority(actor, target);
  if (refusal) return { ok: false, reason: refusal };
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };

  const duplicate = await prisma.offer.findFirst({
    where: { kind: "KISS", status: "PENDING", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "You've already asked." };

  const left = await kissCooldownLeft(prisma, actor.discordUserId);
  if (left > 0) {
    const minutes = Math.max(1, Math.ceil(left / 60_000));
    return { ok: false, reason: `Not for another ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  // Offer + clock in ONE transaction — split across two statements would let two fast clicks both pass.
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
          locationId: actor.locationId ?? null,
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

// The Accept click; the shape db/lib/dmAnswer.js#answerOffer hands back to both faces.
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

  // Re-run the whole gate — either can be bound, hooded, drugged or killed in the wait.
  const refusal = kissAuthority(actor, target);
  if (refusal) return refuse(refusal);

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  // Both dials and both audit rows in one transaction; the scene line stays outside it (it's a network call).
  // The bonuses CROSS: each side is paid for the other's looks, never their own.
  const actorLooks = appearanceBonus(actor.tags);
  const targetLooks = appearanceBonus(target.tags);
  // …and this one does not cross: it lands on both sides, from either side.
  const love = inLoveBonus(actor.tags, target.tags);
  const moved = await prisma.$transaction(async (tx) => {
    const [a, b] = await Promise.all([
      applyKissMood(tx, actor.id, {
        turnId: turn?.id ?? null,
        partnerId: target.id,
        bonus: targetLooks + love,
      }),
      applyKissMood(tx, target.id, {
        turnId: turn?.id ?? null,
        partnerId: actor.id,
        bonus: actorLooks + love,
      }),
    ]);
    // One row per side, both carry turnId — REQUESTS.md §1a — the only thing that lets a ration ever count them.
    await tx.auditLog.createMany({
      data: [
        {
          actorDiscordUserId: actor.discordUserId ?? "system",
          actionType: KISS_ACCEPTED_ACTION,
          targetCharacterId: target.id,
          turnId: turn?.id ?? null,
          locationId: actor.locationId ?? null,
          details: { offerId: offer.id, initiator: actor.name, responder: target.name, moodApplied: Boolean(a) },
        },
        {
          actorDiscordUserId: target.discordUserId ?? "system",
          actionType: KISS_ACCEPTED_ACTION,
          targetCharacterId: actor.id,
          turnId: turn?.id ?? null,
          locationId: target.locationId ?? null,
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
// is private: the only two people told are the two who agreed, each by DM.

module.exports = {
  KISS_APPEARANCE,
  appearanceBonus,
  KISS_COOLDOWN_MS,
  KISS_AUDIT_ACTION,
  KISS_SELECT,
  kissBlock,
  kissAuthority,
  kissCooldownLeft,
  createKissOffer,
  acceptKiss,
};
