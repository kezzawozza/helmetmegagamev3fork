// Escorting — the party you carry with you (docs/systemdocs/MAP.md §3a). The one module that knows what an escort is, the way db/lib/locationGraph.js is the one module that knows what an edge is: you attach somebody once and they come along until something breaks it. The four verdicts escortAuthority returns are the whole rule set — FORCED (a corpse or anyone helpless: attaches on the spot, no asking), CONSENTED (they already said yes to YOU and the window hasn't lapsed: attaches on the spot, the whole reason the window exists — picking the same person back up shouldn't re-ask), ASK (any other living character standing with you: files an ESCORT Offer and DMs Accept/Cancel), null (not standing with you, yourself, buried, or already following somebody else: not offered at all).
// Co-presence is LOCATION grain, not zone — you walk to somebody to take them. Takes `prisma` as a parameter and is deliberately NOT on the @lifeweb/db barrel (db/lib/dm.js convention); require it by path.
const { INCAPACITATING_SLUGS } = require("./incapacitation");
// One module owns the hold and every sentence about it (INTERCEPT.md); this
// only reads it. Required by path rather than off the barrel, same as the rest.
const { heldReasonFor } = require("./intercept");
const { escortButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");
const { CONCEALMENT_TAG_FIELDS, concealmentFrom, forcedNameFrom } = require("./presentedIdentity");
const { whosHere } = require("./whosHere");

// How many turns an accepted escort keeps counting as consent. Two, so a party that walks apart and regroups inside the same day isn't asked twice.
const CONSENT_TURNS = 2;

// Everything escortAuthority reads, and a strict SUPERSET of locationTravel.js's CHARACTER_SELECT — so a row loaded with this can be handed straight to performLocationMove, which every caller now does. That superset is load-bearing: the zoneMoves* fields below are invisible to escorting and essential to moving, since without them the free-crossing claim reads nobody has spent anything and hands out an unlimited allowance. db/test/escort.test.js asserts the superset holds.
const ESCORT_SELECT = {
  id: true,
  name: true,
  status: true,
  concealed: true,
  discordUserId: true,
  locationId: true,
  zoneId: true,
  buriedAt: true,
  escortedById: true,
  escortConsentToId: true,
  escortConsentUntilTurn: true,
  zoneMovesTurnId: true,
  zoneMovesUsed: true,
  zoneMovesBonusUsed: true,
  // Escorting's business as well as the mover's: somebody being held isn't available to be picked up (INTERCEPT.md, and escortAuthority below). heldById rides along because every caller hands this row on to something that may want to know WHO — a select carrying half the hold fails silently at one surface only.
  heldUntil: true,
  heldById: true,
  heldReason: true,
  // What a picker and the party rack are allowed to CALL them — the alias half
  // (age/gender) and the mask half. Carrying somebody is a thing you can plainly
  // do to a stranger, so a hood is offerable; naming them while you carry them
  // is not, which is what escortName below is for.
  age: true,
  gender: true,
  deathMaskTagId: true,
  tags: {
    select: {
      tagId: true,
      equipped: true,
      tag: { select: { slug: true, name: true, ...CONCEALMENT_TAG_FIELDS, forcedName: true } },
    },
  },
};

function isHelpless(target) {
  return Boolean(target.tags?.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug)));
}

// WHAT A LIST MAY CALL SOMEBODY, and what a picker posts back for them.
//
// This does NOT decide who is hidden. `presentRows` in db/lib/whosHere.js does,
// once, and this reads its answer — because the two disagreeing is a bug players
// can reach, and PROXYING.md §5 records the last time it happened: the lists
// judged by your SIGHTING (what you last heard somebody called) while the
// resolver judged the LIVE row, so you would see "a young man" in a dropdown,
// pick him, and be told he was not there.
//
// An earlier draft of this rolled its own live check here and reintroduced
// exactly that: `resolveHoodToken` is sightings-aware, so a hood who spoke
// bare-faced this turn was offered under a token that then resolved to nobody.
//
// `escortView(prisma, leader, { includeDead })` is one round trip that answers
// it for everybody standing here at once. Hand its result to escortName/
// escortKey; with no view they fall back to the hidden-safe answer rather than
// guessing, because the one wrong answer here is printing a name.
async function escortView(prisma, leader, { includeDead = true } = {}) {
  const room = await whosHere(prisma, leader, {
    includeSelf: false,
    includeDead,
    withSightings: true,
    withHoodIds: true,
  });
  const view = new Map();
  for (const row of room.named) {
    view.set(row.characterId, { hidden: false, name: row.name, key: `character:${row.characterId}` });
  }
  const aliasByToken = new Map(room.concealed.filter((c) => c.token).map((c) => [c.token, c.alias]));
  for (const [token, id] of room.hoodIds ?? []) {
    view.set(id, { hidden: true, name: aliasByToken.get(token) ?? "somebody", key: `hood:${token}` });
  }
  return view;
}

// The name a list may print. NEVER row.name for somebody the view calls hidden,
// and never a real name for somebody the view has no answer about.
function escortName(row, view = null) {
  if (!row) return "somebody";
  const seen = view?.get(row.id);
  if (seen) return seen.name;
  return view ? "somebody" : (forcedNameFrom(row.tags) ?? row.name);
}

// The key a picker posts back (db/lib/targetKey.js): a token for a hood, so the
// id never crosses the wire, an id for anybody else. Null means unofferable —
// either the view does not know them, or AUTH_SECRET is unset and hoodToken()
// minted nothing.
function escortKey(row, view = null) {
  const seen = view?.get(row?.id);
  if (seen) return seen.key;
  return view ? null : `character:${row.id}`;
}

// Is this row hidden from the viewer the view was built for?
function escortHidden(row, view = null) {
  return Boolean(view?.get(row?.id)?.hidden);
}

// The verdict. Pure, so the panel, the bot picker and the server-side re-check all share one answer — a picker is a hint and this is the lock. `turnNumber` is the OPEN turn's number the consent window is measured in; a caller with no open turn passes null and simply never gets CONSENTED, the safe direction — they get asked again.
function escortAuthority(leader, target, turnNumber = null) {
  if (!leader?.locationId || !target) return null;
  if (target.id === leader.id) return null;
  if (target.buriedAt) return null;
  // A passenger is not a driver. Somebody already being brought along by
  // somebody ELSE may not start bringing anyone of their own — no exceptions,
  // FORCED included, or a captor who gets swept up themselves would still be
  // walking off with their prisoner in tow. This is the leader-side mirror of
  // the `target.escortedById` guard below; without it, attaching an existing
  // leader to a new one left their own followers dangling on a sub-party no
  // move ever walked (attach() below is the other half — it releases one).
  if (leader.escortedById) return null;
  // Location grain, and a corpse is where it lies. Deliberately stricter than
  // the old canDrag, which reached across the whole zone.
  if (target.locationId !== leader.locationId) return null;

  // FORCE COMES FIRST, and that ordering is the whole point of this block: a prisoner is not somebody's to keep by having asked first, so a friendly arrangement must never outrank the rope. Only a body and the helpless reach it — nobody holds a rank that walks a healthy, conscious person anywhere.
  if (target.status === "DEAD") return "FORCED";
  if (target.status !== "ALIVE") return null;
  // NO concealment refusal. A hood hides WHO somebody is, never THAT they are
  // standing there, and hauling a stranger along is one of the plainest things
  // you can do to somebody whose name you do not know (PROXYING.md §5). It used
  // to refuse here on the raw column, which meant a masked friend bleeding out
  // could not be carried to a surgeon by anyone. What a hood still costs is the
  // name: escortName() above is what every list prints instead.
  // Somebody has hold of them (INTERCEPT.md). Above the FORCED branches on purpose: an ambusher's own prisoner isn't theirs to walk off with either — the ambush is a standoff, and taking them somewhere is what the Gambit is for. performLocationMove re-checks this per follower, since a hold can land between the pick and the walk.
  if (target.heldUntil && new Date(target.heldUntil).getTime() > Date.now()) return null;
  if (isHelpless(target)) return "FORCED";

  // Somebody else's, and willingly — the only kind of follower this still stops. One leader per follower is the column's rule, and for the willing it's also the manners: you ask a person, you don't take them off somebody. A FORCED target reached its verdict above and never gets here.
  if (target.escortedById && target.escortedById !== leader.id) return null;

  if (
    turnNumber != null &&
    target.escortConsentToId === leader.id &&
    (target.escortConsentUntilTurn ?? -1) >= turnNumber
  ) {
    return "CONSENTED";
  }

  // Everybody else standing here: a person who can say no, and therefore has to be asked.
  return "ASK";
}

// Why they follow, for the card under their name. Not a refusal — every candidate this is called for is already attachable.
function escortReason(target, verdict) {
  if (target.status === "DEAD") return "a body";
  if (verdict === "CONSENTED") return "willing";
  const stopper = target.tags?.find((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
  if (stopper) return stopper.tag.name.toLowerCase();
  return null;
}

// Why they CANNOT be taken, for the answer a click gets. escortReason above is its opposite number and only speaks for people who passed. Their leader is deliberately not named: the refusal doesn't need it, and naming them would say more than the player asked.
function escortRefusal(leader, target) {
  if (!target) return "They aren't here any more.";
  if (target.buriedAt) return "They're in the ground.";
  // The one wording every "they aren't here" refusal in the game shares (db/lib/presence.js), so this one doesn't invent a second.
  if (!leader?.locationId || target.locationId !== leader.locationId) return `${handshakeName(target)} isn't here.`;
  if (leader.escortedById) return "You're being brought along yourself.";
  if (target.escortedById && target.escortedById !== leader.id) return "They're already with somebody.";
  // A hold is the one refusal here a player cannot see for themselves, and the
  // one most likely to matter: somebody who went down in a fight is held until
  // the turn ends (INTERCEPT.md), which is exactly when a friend most wants to
  // carry them to a surgeon. It used to fall through to the flat sentence
  // below, so the answer to "why can't I pick him up" was nothing at all.
  //
  // heldReasonFor's own wording, not a second one — and it names no holder,
  // which keeps this refusal as quiet as the rest of them.
  const held = heldReasonFor(target);
  if (held) return held;
  return "You can't take them along.";
}

// Everyone standing here, each with its verdict. The panel draws the lot: nothing is filtered out for being ASK, since "you'd have to ask them" is the useful half of the answer.
async function escortCandidates(prisma, leader, turnNumber = null) {
  if (!leader?.locationId) return [];
  // NOT hereWhere: that is the named half and drops hoods (db/lib/presence.js).
  // Everybody standing here, mask or no mask — escortAuthority below is the
  // filter, and it no longer refuses one.
  const rows = await prisma.character.findMany({
    where: {
      locationId: leader.locationId,
      id: { not: leader.id },
      OR: [{ status: "ALIVE" }, { status: "DEAD", buriedAt: null }],
    },
    select: ESCORT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  // One view for the whole room, built off presentRows so this list and
  // resolveHoodToken can never disagree about who is hidden.
  const view = await escortView(prisma, leader);
  const out = [];
  for (const row of rows) {
    const verdict = escortAuthority(leader, row, turnNumber);
    if (!verdict) continue;
    // A KEY, not an id — a hood's id never goes to a browser, because
    // /api/avatar/<id> answers with a face. Null is unofferable: somebody the
    // view has no answer about, or a hood with no token to mint one from.
    const key = escortKey(row, view);
    if (!key) continue;
    out.push({
      id: key,
      name: escortName(row, view),
      status: row.status,
      verdict,
      attached: row.escortedById === leader.id,
      reason: escortReason(row, verdict),
    });
  }
  return out;
}

// The party, in the order it was picked up. Used by the panel and re-loaded inside performLocationMove's own transaction, which is the copy that counts.
async function partyOf(prisma, leaderId, { tx = null } = {}) {
  const db = tx ?? prisma;
  return db.character.findMany({
    where: { escortedById: leaderId },
    select: ESCORT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
}

// Attach, having already been told the verdict allows it. Conditional updateMany: the WHERE re-asserts nobody else has claimed them between the check and the write, so two leaders clicking at once means one party and one "somebody just took them".
// `takeover` drops that clause, and only a FORCED verdict may pass it — those three are taken rather than agreed with, so somebody else already holding the column isn't a reason to refuse; escortAuthority reaches their verdict without ever looking at it. The conditional WHERE stays default because the race it guards is real for everybody else: two people asking the same willing follower still resolve to one party.
async function attach(prisma, leaderId, targetId, { tx = null, takeover = false } = {}) {
  const db = tx ?? prisma;
  const claimed = await db.character.updateMany({
    where: takeover
      ? { id: targetId }
      : { id: targetId, OR: [{ escortedById: null }, { escortedById: leaderId }] },
    data: { escortedById: leaderId },
  });
  if (claimed.count > 0) {
    // A passenger cannot lead a party of their own (escortAuthority above),
    // so whoever THIS target was themselves bringing along is released the
    // moment somebody else picks them up — otherwise it would sit as an
    // orphaned sub-party nobody's move ever walks (MAP.md §3a).
    await releaseParty(prisma, targetId, { tx: db });
  }
  return claimed.count > 0;
}

async function detach(prisma, targetId, { tx = null } = {}) {
  const db = tx ?? prisma;
  await db.character.updateMany({ where: { id: targetId }, data: { escortedById: null } });
}

// Lets go of everyone `leaderId` was bringing along. Called by attach() and acceptEscort(): a passenger cannot lead a party of their own.
async function releaseParty(prisma, leaderId, { tx = null } = {}) {
  const db = tx ?? prisma;
  await db.character.updateMany({ where: { escortedById: leaderId }, data: { escortedById: null } });
}

// --- The consent handshake ------------------------------------------------
// Modelled on db/lib/bind.js, which already does exactly this split: the helpless get no say, everybody else gets an Offer. The bot's generic accept/decline plumbing (bot/src/lib/offers.js) switches on offer.kind, so ESCORT rides the same two buttons and the same router branch.

// What one side of a handshake may call the other, WITHOUT a room view to read.
// createEscortOffer and acceptEscort both run from a DM button, where there is
// no picker and no viewer's sightings to consult — so this is the fallback, and
// it fails closed: a face under a mask is "somebody", never a name.
//
// It is a live concern now rather than a theoretical one. Before hoods could be
// escorted at all, neither side of this handshake could be masked; now the ask
// goes out to a hood, and "Sir Alder is with you." on their Accept would hand
// over the name the helmet was bought to hide.
function handshakeName(row) {
  if (!row) return "somebody";
  const forced = forcedNameFrom(row.tags);
  if (forced) return forced; // a forced name is not hiding (PROXYING.md §5).
  if (row.status === "DEAD") {
    const held = Array.isArray(row.tags) && row.deathMaskTagId
      ? row.tags.find((ct) => ct.tagId === row.deathMaskTagId)?.tag
      : null;
    return held?.concealsIdentity && held?.concealSprite ? "somebody" : row.name;
  }
  const piece = concealmentFrom(row.tags);
  return piece && (piece.forced || row.concealed) ? "somebody" : row.name;
}

// Files the ask. Returns { ok, offer, dm } or { ok: false, reason }.
async function createEscortOffer(prisma, { actor, target, turn }) {
  if (!target.discordUserId) return { ok: false, reason: `${handshakeName(target)} can't be reached.` };
  const duplicate = await prisma.offer.findFirst({
    where: { kind: "ESCORT", status: "PENDING", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "You've already asked." };
  const offer = await prisma.offer.create({
    data: { kind: "ESCORT", turnId: turn.id, initiatorId: actor.id, responderId: target.id },
  });
  return {
    ok: true,
    offer,
    dm: {
      discordUserId: target.discordUserId,
      content: `*${handshakeName(actor)}* wants to take you along.`,
      components: escortButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id, "ESCORT"),
    },
  };
}

// The Accept click. Stamps the consent window AND attaches, because being asked and then having to be picked up separately is the same yes twice. Returns { ok, line, dms } or { ok: false, reason, dms }.
async function acceptEscort(prisma, offer, _responder) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  const [actor, target] = await Promise.all([
    prisma.character.findUnique({ where: { id: offer.initiatorId }, select: ESCORT_SELECT }),
    prisma.character.findUnique({ where: { id: offer.responderId }, select: ESCORT_SELECT }),
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
  if (!turn) return refuse("No turn is open.");
  if (!actor || !target) return refuse("They aren't here any more.");
  // They may have walked apart between the ask and the answer. The window is still stamped — saying yes is saying yes — but nobody is attached to somebody standing somewhere else.
  const together = actor.locationId && actor.locationId === target.locationId;
  // A passenger cannot lead (escortAuthority): the asker may themselves have
  // been picked up between the ask and the answer, and accepting then stamps
  // the consent window but attaches nobody.
  const attaches = together && !actor.escortedById;

  await prisma.$transaction(async (tx) => {
    await tx.character.update({
      where: { id: target.id },
      data: {
        escortConsentToId: actor.id,
        escortConsentUntilTurn: turn.number + CONSENT_TURNS,
        ...(attaches ? { escortedById: actor.id } : {}),
      },
    });
    if (attaches) {
      // attach()'s identical comment: a passenger cannot lead a party of
      // their own, so accepting releases whoever the target themselves was
      // bringing along.
      await releaseParty(prisma, target.id, { tx });
    }
    await tx.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "ACCEPTED", respondedAt: new Date(), resolvedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: target.discordUserId ?? "system",
        actionType: "escort_consented",
        targetCharacterId: actor.id,
        turnId: turn.id,
        details: {
          follower: target.name,
          leader: actor.name,
          untilTurn: turn.number + CONSENT_TURNS,
          attached: attaches,
        },
      },
    });
  });

  return {
    ok: true,
    line: attaches
      ? `You're with ${handshakeName(actor)} now.`
      : together
        ? `You agreed, but ${handshakeName(actor)} can't bring you along right now.`
        : `You agreed, but ${handshakeName(actor)} isn't here any more.`,
    dms: actor.discordUserId
      ? [
          {
            discordUserId: actor.discordUserId,
            content: attaches
              ? `${handshakeName(target)} is with you.`
              : together
                ? `${handshakeName(target)} agreed, but you can't bring them along right now.`
                : `${handshakeName(target)} agreed, but you've moved away.`,
          },
        ]
      : [],
  };
}

module.exports = {
  CONSENT_TURNS,
  ESCORT_SELECT,
  escortAuthority,
  escortReason,
  escortRefusal,
  escortCandidates,
  escortView,
  escortName,
  escortKey,
  escortHidden,
  partyOf,
  attach,
  detach,
  createEscortOffer,
  acceptEscort,
};
