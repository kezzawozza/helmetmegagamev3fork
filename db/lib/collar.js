// The bomb collar (docs/systemdocs/COLLAR.md).
//
// Three verbs over two tags. The LOOSE collar is the `bomb-collar` item; the
// SHUT one is the `bomb-collar-locked` trait, which is `removable: false` so
// the ordinary Remove flow cannot take it off. Apply Collar spends the item to
// write the trait, the Collar Key turns the trait back into an item, and the
// Remote Detonator turns whoever wears the trait into mist.
//
// Apply Collar has two doors, exactly as db/lib/bind.js does: a target who
// could stop you is ASKED (an Offer of kind COLLAR, on the shared button
// prefixes), and one who could not -- dead, or holding an INCAPACITATING tag --
// is collared on the spot. Yourself is a third door and needs no offer either;
// you are not asking anybody. All three end in applyCollar, so what wearing a
// collar means is written once.
//
// Unlock and Detonate ask nobody. That asymmetry is the point of the seat.
//
// Takes `prisma` as the first parameter and is NOT on the @lifeweb/db barrel;
// require it by path.
const { addToStack, dropCharacterTag } = require("./tagWrites");
const { isHere, notHereMessage } = require("./presence");
const { offerButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { INCAPACITATING_SLUGS } = require("./incapacitation");
const { applyDeathToRow } = require("./characterDeath");
const { applyDeathTeardown } = require("./deathTeardown");
const { locationLine } = require("./placeLine");
const { sendDm } = require("./dm");

const COLLAR_ITEM_SLUG = "bomb-collar";
const COLLAR_LOCKED_SLUG = "bomb-collar-locked";
const DETONATOR_SLUG = "remote-detonator";
const COLLAR_KEY_SLUG = "collar-key";

// Deliberately the Rite of Judgement's own words (db/lib/riteEffects.js). A
// collar and a rite do the same thing to a body, and Bascinet rewrites the
// sentence in one place rather than two. Imported by VALUE rather than by
// require: riteEffects pulls in the whole rites system, and a collar has no
// business loading it.
const DETONATION_DEATH_REASON =
  "Something looked at your likeness and decided against you. You exploded into mist.";

// `location` for the scene line, `tags` for the collar check, `discordRoleId`
// for the teardown that applyDeathToRow is about to null.
const COLLAR_SELECT = {
  id: true,
  name: true,
  status: true,
  locationId: true,
  zoneId: true,
  concealed: true,
  buriedAt: true,
  discordUserId: true,
  discordRoleId: true,
  location: { select: { id: true, name: true, discordChannelId: true } },
  tags: { select: { tagId: true, tag: { select: { slug: true } } } },
};

function heldSlugs(character) {
  return new Set((character?.tags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

function wearsCollar(character) {
  return heldSlugs(character).has(COLLAR_LOCKED_SLUG);
}

// Dead or helpless: no leave needed. bind.js's rule, read off the same derived
// set, so a tag that stops counting as incapacitating stops counting here too.
function needsNoConsent(target) {
  return target.status === "DEAD" || (target.tags ?? []).some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
}

// The gate every collar verb re-runs, at the ask AND at the answer. Unlike
// kissAuthority there is no covered-face rule: a hood over somebody's head
// does not stop a collar going round their neck, so `allowConcealed` is on
// the same way db/lib/search.js#searchAuthority has it.
function collarAuthority(actor, target, { verb = "that" } = {}) {
  if (!actor || !target) return "They aren't here.";
  if (actor.status !== "ALIVE") return "You can't do that right now.";
  if (!isHere(actor, target, { allowConcealed: true })) return notHereMessage(target);
  // Detonating a corpse is the one verb that still reads on a body; the other
  // two need somebody alive to act on.
  if (verb !== "detonate" && target.status !== "ALIVE") return notHereMessage(target);
  return null;
}

async function requireTag(db, slug) {
  const tag = await db.tag.findUnique({ where: { slug }, select: { id: true, name: true, stackable: true } });
  if (!tag) throw new Error(`The ${slug} tag is missing from the catalog.`);
  return tag;
}

// Both doors of Apply Collar land here. Spends one loose collar off the actor
// and writes the locked trait onto the target, in one transaction so a crash
// can never do one without the other -- the failure that would either mint a
// collar or eat one.
//
// `actor` and `target` may be the SAME character (collaring yourself), which
// is why the drop and the add are ordered rather than run in parallel.
async function applyCollar(prisma, { actor, target, turn, offerId = null }) {
  const [item, locked] = await Promise.all([
    requireTag(prisma, COLLAR_ITEM_SLUG),
    requireTag(prisma, COLLAR_LOCKED_SLUG),
  ]);
  const effect = {
    targetCharacterId: target.id,
    targetName: target.name,
    tagId: locked.id,
    tagName: locked.name,
    ...(offerId ? { offerId, consented: true } : {}),
  };
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, actor.id, item.id, 1);
    await addToStack(tx, target.id, locked.id, 1, { source: "EVENT", stackable: locked.stackable });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: "request_apply_collar",
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        locationId: actor.locationId ?? null,
        details: effect,
      },
    });
  });
  return effect;
}

// Files the consent offer. Mirrors createBindOffer, including the duplicate
// guard -- a second ask in the same turn is refused rather than DMing twice.
async function createCollarOffer(prisma, { actor, target, turn }) {
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };
  const duplicate = await prisma.offer.findFirst({
    where: { kind: "COLLAR", status: "PENDING", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "You've already asked." };
  const offer = await prisma.offer.create({
    data: { kind: "COLLAR", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
  });
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: target.discordUserId,
      content: `*${actor.name}* wants to put a shock collar on you. Accept?`,
      components: offerButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id),
    },
  };
}

// The Accept click; the shape db/lib/dmAnswer.js#answerOffer hands both faces.
// The whole gate is re-run: an offer can sit unanswered for hours, in which
// either side can move, be collared by somebody else, or die.
async function acceptCollar(prisma, offer, responder) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const [actor, target] = await Promise.all([
    prisma.character.findUnique({ where: { id: offer.initiatorId }, select: COLLAR_SELECT }),
    prisma.character.findUnique({ where: { id: offer.responderId }, select: COLLAR_SELECT }),
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
  if (!turn || turn.id !== offer.turnId) return refuse("That offer was for a turn that's over.");
  if (!actor || actor.status !== "ALIVE") return refuse("They aren't around any more.");
  if (!target || target.status !== "ALIVE") return refuse("You aren't in a state for that.");
  const refusal = collarAuthority(actor, target, { verb: "collar" });
  if (refusal) return refuse(refusal);
  if (wearsCollar(target)) return refuse(`${target.name} already has a collar on.`);
  // Re-read the actor's own stock: they may have handed it away while waiting.
  if (!heldSlugs(actor).has(COLLAR_ITEM_SLUG)) return refuse(`${actor.name} has no collar to put on you.`);

  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "That offer's gone.", dms: [] };

  await applyCollar(prisma, { actor, target, turn, offerId: offer.id });
  await prisma.offer.update({
    where: { id: offer.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), outcome: { collared: true } },
  });
  return {
    ok: true,
    collaredId: target.id,
    line: `You let ${actor.name} put a collar on you.`,
    dms: actor.discordUserId
      ? [{ discordUserId: actor.discordUserId, content: `${target.name} let you put a collar on them.` }]
      : [],
  };
}

// The key's half. The collar comes off the target and lands in the UNLOCKER's
// hands, not the freed person's -- an Exactor who unlocks a collar keeps it to
// use again, which is the whole reason a key is worth carrying.
async function unlockCollar(prisma, { actor, target, turn }) {
  const [item, locked] = await Promise.all([
    requireTag(prisma, COLLAR_ITEM_SLUG),
    requireTag(prisma, COLLAR_LOCKED_SLUG),
  ]);
  const effect = { targetCharacterId: target.id, targetName: target.name, tagId: item.id, tagName: item.name };
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, target.id, locked.id, 1);
    await addToStack(tx, actor.id, item.id, 1, { source: "EVENT", stackable: item.stackable });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: "request_unlock_collar",
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        locationId: actor.locationId ?? null,
        details: effect,
      },
    });
  });
  return effect;
}

// The trigger. A gib: no corpse, every tag vaporized, nothing left to loot or
// bury. The collar is dropped FIRST so the audit row records what was on them,
// and because a gib deletes the rows anyway -- doing it in the open makes the
// ledger honest about where the collar went.
//
// Returns { ok: false, reason } when there is nothing to set off, so the caller
// can say so without ever having read the target's tags itself.
async function detonateCollar(prisma, { actor, target, turn }) {
  if (!wearsCollar(target)) return { ok: false, reason: `${target.name} doesn't have a collar on.` };
  const locked = await requireTag(prisma, COLLAR_LOCKED_SLUG);

  // Captured before applyDeathToRow nulls the column -- the teardown still owes
  // Discord this role's deletion.
  const roleId = target.discordRoleId;
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, target.id, locked.id, 1);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actor.discordUserId ?? "system",
        actionType: "request_detonate_collar",
        targetCharacterId: target.id,
        turnId: turn?.id ?? null,
        locationId: actor.locationId ?? null,
        details: { targetCharacterId: target.id, targetName: target.name },
      },
    });
  });

  const { claimed } = await applyDeathToRow(prisma, target, {
    turn,
    gib: true,
    content: `${target.name} was detonated.`,
  });
  // Something else killed them between the roster load and here. The collar is
  // spent either way; nothing explodes twice.
  if (!claimed) return { ok: true, name: target.name, alreadyDead: true };

  const { member } = await applyDeathTeardown(prisma, { ...target, discordRoleId: roleId });
  if (member) {
    await sendDm(prisma, target.discordUserId, `You have died.\n${DETONATION_DEATH_REASON}`, {
      source: "collar",
    }).catch((err) => console.error(`detonation DM for ${target.name}:`, err?.message ?? err));
  }
  await locationLine(prisma, target.location, `${target.name} explodes into mist!`);
  return { ok: true, name: target.name, alreadyDead: false };
}

module.exports = {
  COLLAR_ITEM_SLUG,
  COLLAR_LOCKED_SLUG,
  DETONATOR_SLUG,
  COLLAR_KEY_SLUG,
  COLLAR_SELECT,
  DETONATION_DEATH_REASON,
  heldSlugs,
  wearsCollar,
  needsNoConsent,
  collarAuthority,
  applyCollar,
  createCollarOffer,
  acceptCollar,
  unlockCollar,
  detonateCollar,
};
