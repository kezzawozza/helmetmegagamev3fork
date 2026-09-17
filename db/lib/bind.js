// Binding someone (docs/systemdocs/LESSONS.md §Bind; REQUESTS.md §5b).
//
// Two doors to one effect. A target who can't stop you — dead, or holding an
// INCAPACITATING tag — is bound on the spot, as before. Anyone else has to
// agree: the web action files an Offer of kind BIND, the target gets a DM
// with Accept / Decline, and only Accept fires the BIND_CHARACTER request.
// Both doors end in applyBind, so what "bound" means is written once, here,
// where the bot can reach it too.
//
// Takes `prisma` as the first parameter and is NOT on the barrel; require it
// by path.
const { addToStack } = require("./tagWrites");
const { applyMood } = require("./mood");
const { expiryForGrant } = require("./grantExpiry");
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { INCAPACITATING_SLUGS } = require("./incapacitation");

const BIND_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  concealed: true,
  buriedAt: true,
  discordUserId: true,
  tags: { select: { tagId: true, tag: { select: { slug: true } } } },
};

async function requireBoundTag(db) {
  const bound = await db.tag.findUnique({
    where: { slug: "bound" },
    select: { id: true, name: true, stackable: true, defaultDurationTurns: true },
  });
  if (!bound) throw new Error("The Bound tag is missing from the catalog.");
  return bound;
}

// Ropes or shackles. Shackled (the Dungeons' Shackle button) is Bound in
// every way but Break Restraints, so every "is this person tied up" check —
// Bind's refusal, Torture, Mutilate, Free — reads both.
const RESTRAINT_SLUGS = Object.freeze(["bound", "shackled"]);

function isBound(target) {
  return target.tags.some((ct) => RESTRAINT_SLUGS.includes(ct.tag.slug));
}

// Dead or helpless: no leave needed.
function needsNoConsent(target) {
  return target.status === "DEAD" || target.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
}

// Grants `bound` and writes its audit row in one transaction. Returns the
// effect. `actor` needs id/name/discordUserId; `target` is a BIND_SELECT row.
// The caller owes afterInventoryChange and the target's DM.
async function applyBind(prisma, { actor, target, turn, offerId = null }) {
  const bound = await requireBoundTag(prisma);
  const expiresTurn = await expiryForGrant(prisma, bound, turn, { characterId: target.id, where: "bindCharacter" });
  // Break Restraints' clock (db/lib/breakRestraints.js, LESSONS.md §3c) only
  // starts on a FRESH bind — a re-bind of someone already tied up must not
  // reset their progress toward automatic release.
  const freshBind = !isBound(target);
  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    tagId: bound.id,
    tagName: bound.name,
    expiresTurn,
    ...(offerId ? { offerId, consented: true } : {}),
  };
  await prisma.$transaction(async (tx) => {
    await addToStack(tx, target.id, bound.id, 1, { source: "EVENT", expiresTurn, stackable: bound.stackable });
    if (freshBind) {
      await tx.character.update({
        where: { id: target.id },
        data: { boundSinceTurnNumber: turn?.number ?? null },
      });
    }
    // Being tied up is frightening, consented to or not (MOOD.md); every night
    // still bound costs more, in db/lib/moodPass.js.
    await applyMood(tx, target.id, { kind: "BOUND" });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: "request_bind_character",
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        details: effect,
      },
    });
  });
  return effect;
}

// Files the consent offer. Returns { ok, offer, dm } or { ok: false, reason }.
async function createBindOffer(prisma, { actor, target, turn }) {
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };
  const duplicate = await prisma.offer.findFirst({
    where: { kind: "BIND", status: "PENDING", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "You've already asked." };
  const offer = await prisma.offer.create({
    data: { kind: "BIND", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
  });
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: target.discordUserId,
      content: `*${actor.name}* wants to bind you. Accept?`,
      components: offerButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id),
    },
  };
}

// The Accept click. Returns { ok, line, dms, boundId } or { ok: false, reason, dms }.
async function acceptBind(prisma, offer, responder) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const [actor, target] = await Promise.all([
    prisma.character.findUnique({ where: { id: offer.initiatorId }, select: BIND_SELECT }),
    prisma.character.findUnique({ where: { id: offer.responderId }, select: BIND_SELECT }),
  ]);
  const refuse = async (reason) => {
    await prisma.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    return {
      ok: false,
      reason,
      dms: actor?.discordUserId ? [{ discordUserId: actor.discordUserId, content: `Your offer fell through: ${reason}` }] : [],
    };
  };
  if (!turn || turn.id !== offer.turnId) return refuse("That offer was for a turn that's over.");
  if (!actor || actor.status !== "ALIVE") return refuse("They aren't around any more.");
  if (!target || target.status !== "ALIVE") return refuse("You aren't in a state to be bound.");
  // allowConcealed, matching the ASK side and every other body verb: the offer
  // that got here was made to somebody standing in front of the binder, and a
  // mask does not stop a rope. Without it, a hood who SAID YES to being bound
  // was refused at the accept, which is the one place consent was already given.
  if (!isHere(actor, target, { allowConcealed: true })) return refuse(notHereMessage(target));
  if (isBound(target)) return refuse(`${target.name} is already bound.`);

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  await applyBind(prisma, { actor, target, turn, offerId: offer.id });
  await prisma.offer.update({
    where: { id: offer.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), outcome: { bound: true } },
  });
  return {
    ok: true,
    boundId: target.id,
    line: `You let ${actor.name} bind you.`,
    dms: actor.discordUserId ? [{ discordUserId: actor.discordUserId, content: `${target.name} let you bind them.` }] : [],
  };
}

module.exports = { BIND_SELECT, RESTRAINT_SLUGS, requireBoundTag, isBound, needsNoConsent, applyBind, createBindOffer, acceptBind };
