// Escorting — the party you carry with you (docs/systemdocs/MAP.md §3a).
//
// This is the one module that knows what an escort is, the way
// db/lib/locationGraph.js is the one module that knows what an edge is. Two
// mechanics used to answer "who follows me" with the same predicate written
// twice: the MOVE_CHARACTER request, which shoved one person one hop for
// free, and the drag picker on the Travel confirm, which had to be re-ticked
// before every single move. Both are gone. You attach somebody once and they
// come along until something breaks it.
//
// The four verdicts escortAuthority returns are the whole rule set:
//
//   FORCED     a corpse, anyone helpless, or a member of the faction you
//              lead. Attaches on the spot, no asking — the old canDrag rule.
//   CONSENTED  they already said yes to YOU and the window has not lapsed.
//              Attaches on the spot, and this is the whole reason the window
//              exists: picking the same person back up should not re-ask.
//   ASK        any other living character standing with you. Files an ESCORT
//              Offer and DMs them Accept / Cancel.
//   null       not standing with you, yourself, buried, or already following
//              somebody else. Not offered at all.
//
// Co-presence is LOCATION grain, not zone: canDrag used to scoop the whole
// zone, which meant picking a body up from across the map. You walk to
// somebody to take them now.
//
// Takes `prisma` as a parameter and is deliberately NOT on the @lifeweb/db
// barrel — the db/lib/dm.js convention. Require it by path.
const { INCAPACITATING_SLUGS } = require("./incapacitation");
const { isUnaffiliated } = require("./factionConstants");
const { hereWhere, notHereMessage } = require("./presence");
const { escortButtonRow } = require("./offerRow");
const { DM_ACTION, dmAction } = require("./dmActions");

// How many turns an accepted escort keeps counting as consent. Two, so a
// party that walks apart and regroups inside the same day is not asked twice.
const CONSENT_TURNS = 2;

// Everything escortAuthority reads, and a strict SUPERSET of
// locationTravel.js's CHARACTER_SELECT — so a row loaded with this can be
// handed straight to performLocationMove, which every caller now does.
//
// That superset is load-bearing, not tidiness. The zoneMoves* fields below
// are invisible to escorting and essential to moving: without them the
// free-crossing claim reads nobody has spent anything and hands out an
// unlimited allowance. db/test/escort.test.js asserts the superset holds.
const ESCORT_SELECT = {
  id: true,
  name: true,
  status: true,
  concealed: true,
  discordUserId: true,
  locationId: true,
  zoneId: true,
  factionId: true,
  // The RELATION, not just the id. locationTravel.js's CHARACTER_SELECT
  // selects only factionId, so canDrag's isUnaffiliated(mover.faction) read
  // undefined and returned true inside performLocationMove's own re-check —
  // which quietly refused every faction leader who tried to bring a member
  // along. Selecting it here is what makes the faction branch below work at
  // all.
  faction: { select: { slug: true } },
  isLeader: true,
  buriedAt: true,
  escortedById: true,
  escortConsentToId: true,
  escortConsentUntilTurn: true,
  // Not escorting's business — performLocationMove's. See above.
  zoneMovesTurnId: true,
  zoneMovesUsed: true,
  zoneMovesBonusUsed: true,
  // Escorting's business as well as the mover's: somebody being held is not
  // available to be picked up (INTERCEPT.md, and escortAuthority below).
  // heldById rides along because every caller hands this row on to something
  // that may want to know WHO — a select carrying half the hold is the kind of
  // gap that fails silently at one surface only.
  heldUntil: true,
  heldById: true,
  heldReason: true,
  tags: { select: { equipped: true, tag: { select: { slug: true, name: true } } } },
};

function isHelpless(target) {
  return Boolean(target.tags?.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug)));
}

// The verdict. Pure, so the panel, the bot picker and the server-side
// re-check all share one answer — a picker is a hint and this is the lock.
//
// `turnNumber` is the OPEN turn's number, which the consent window is
// measured in. A caller with no open turn passes null and simply never gets
// CONSENTED, which is the safe direction: they get asked again.
function escortAuthority(leader, target, turnNumber = null) {
  if (!leader?.locationId || !target) return null;
  if (target.id === leader.id) return null;
  if (target.buriedAt) return null;
  // Location grain, and a corpse is where it lies. Deliberately stricter than
  // the old canDrag, which reached across the whole zone.
  if (target.locationId !== leader.locationId) return null;

  // FORCE COMES FIRST, and that ordering is the whole point of this block.
  // The `escortedById` guard below used to sit above these three, so a
  // friendly arrangement outranked the rope: tie somebody up while they were
  // walking with a friend and their captor could not take them, because the
  // friend had the column. A prisoner is not somebody's to keep by having
  // asked first.
  if (target.status === "DEAD") return "FORCED";
  if (target.status !== "ALIVE") return null;
  // The presence rule, mirrored from db/lib/presence.js#isHere: a hood is the
  // game's "you don't know who this is", so it is off every picker and every
  // gate. The old MOVE_CHARACTER already refused a hood for this reason; the
  // old canDrag never checked, because it read a zone roster instead.
  if (target.concealed) return null;
  // Somebody has hold of them (INTERCEPT.md). Above the FORCED branches on
  // purpose: an ambusher's own prisoner is not theirs to walk off with either
  // — the ambush is a standoff, and taking them somewhere is what the Gambit
  // is for. performLocationMove re-checks this per follower, since a hold can
  // land between the pick and the walk.
  if (target.heldUntil && new Date(target.heldUntil).getTime() > Date.now()) return null;
  if (isHelpless(target)) return "FORCED";

  // Unaffiliated is not a faction (FACTIONS.md §1a), so a Leader of it — which
  // no role grants, but a GM could create — must not command everyone
  // unaffiliated. Carried over from canDrag, where it was load-bearing.
  if (!isUnaffiliated(leader.faction) && leader.isLeader && target.factionId && target.factionId === leader.factionId) {
    return "FORCED";
  }

  // Somebody else's, and willingly — which is the only kind of follower this
  // still stops. One leader per follower is the column's own rule, and for
  // the willing it is also the manners: you ask a person, you don't take them
  // off somebody. A FORCED target reached its verdict above and never gets
  // here.
  if (target.escortedById && target.escortedById !== leader.id) return null;

  if (
    turnNumber != null &&
    target.escortConsentToId === leader.id &&
    (target.escortConsentUntilTurn ?? -1) >= turnNumber
  ) {
    return "CONSENTED";
  }

  // Everybody else standing here: a person who can say no, and therefore has
  // to be asked.
  return "ASK";
}

// Why they follow, for the card under their name. Not a refusal — every
// candidate this is called for is already attachable.
function escortReason(target, verdict) {
  if (target.status === "DEAD") return "a body";
  if (verdict === "CONSENTED") return "willing";
  const stopper = target.tags?.find((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug));
  if (stopper) return stopper.tag.name.toLowerCase();
  if (verdict === "FORCED") return "your faction";
  return null;
}

// Why they CANNOT be taken, for the answer a click gets. escortReason above
// is its opposite number and only speaks for people who passed.
//
// It exists because the refusal used to be one flat "You can't take them
// along", which on a picker that silently omits whoever it won't take reads
// as the game pretending a person standing in front of you isn't there.
//
// hereWhere() has already dropped the far away, the hooded, the buried and
// yourself before a candidate is ever judged, so the branch that actually
// fires is the last one — and since force now outranks an arrangement, that
// branch can only be a WILLING follower, whose walking with somebody is
// plain to see anyway. Their leader is deliberately not named: the refusal
// does not need it, and naming them would say more than the player asked.
function escortRefusal(leader, target) {
  if (!target) return "They aren't here any more.";
  if (target.buriedAt) return "They're in the ground.";
  // The one wording every "they aren't here" refusal in the game shares
  // (db/lib/presence.js), so this one does not invent a second.
  if (!leader?.locationId || target.locationId !== leader.locationId) return notHereMessage(target);
  if (target.escortedById && target.escortedById !== leader.id) return "They're already with somebody.";
  return "You can't take them along.";
}

// Everyone standing here, each with its verdict. The panel draws the lot:
// nothing is filtered out for being ASK, because "you'd have to ask them"
// is the useful half of the answer.
async function escortCandidates(prisma, leader, turnNumber = null) {
  if (!leader?.locationId) return [];
  const rows = await prisma.character.findMany({
    where: hereWhere(leader, { includeDead: true }),
    select: ESCORT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const out = [];
  for (const row of rows) {
    const verdict = escortAuthority(leader, row, turnNumber);
    if (!verdict) continue;
    out.push({
      id: row.id,
      name: row.name,
      status: row.status,
      verdict,
      attached: row.escortedById === leader.id,
      reason: escortReason(row, verdict),
    });
  }
  return out;
}

// The party, in the order it was picked up. Used by the panel and re-loaded
// inside performLocationMove's own transaction, which is the copy that counts.
async function partyOf(prisma, leaderId, { tx = null } = {}) {
  const db = tx ?? prisma;
  return db.character.findMany({
    where: { escortedById: leaderId },
    select: ESCORT_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
}

// Attach, having already been told the verdict allows it. Conditional
// updateMany: the WHERE re-asserts that nobody else has claimed them between
// the check and the write, so two leaders clicking at once means one party
// and one "somebody just took them".
//
// `takeover` drops that clause, and only a FORCED verdict may pass it — a
// corpse, anyone helpless, a member of the faction you lead. Those three are
// taken rather than agreed with, so somebody else already holding the column
// is not a reason to refuse; escortAuthority reaches their verdict without
// ever looking at it. The conditional WHERE stays the default because the
// race it guards is real for everybody else: two people asking the same
// willing follower still resolve to one party.
async function attach(prisma, leaderId, targetId, { tx = null, takeover = false } = {}) {
  const db = tx ?? prisma;
  const claimed = await db.character.updateMany({
    where: takeover
      ? { id: targetId }
      : { id: targetId, OR: [{ escortedById: null }, { escortedById: leaderId }] },
    data: { escortedById: leaderId },
  });
  return claimed.count > 0;
}

async function detach(prisma, targetId, { tx = null } = {}) {
  const db = tx ?? prisma;
  await db.character.updateMany({ where: { id: targetId }, data: { escortedById: null } });
}

// --- The consent handshake ------------------------------------------------
//
// Modelled on db/lib/bind.js, which already does exactly this split: the
// helpless get no say, everybody else gets an Offer. The bot's generic
// accept/decline plumbing (bot/src/lib/offers.js) switches on offer.kind, so
// ESCORT rides the same two buttons and the same router branch.

// Files the ask. Returns { ok, offer, dm } or { ok: false, reason }.
async function createEscortOffer(prisma, { actor, target, turn }) {
  if (!target.discordUserId) return { ok: false, reason: `${target.name} can't be reached.` };
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
      content: `*${actor.name}* wants to take you along.`,
      components: escortButtonRow(offer.id),
      meta: dmAction(DM_ACTION.OFFER, offer.id, "ESCORT"),
    },
  };
}

// The Accept click. Stamps the consent window AND attaches, because being
// asked and then having to be picked up separately is the same yes twice.
// Returns { ok, line, dms } or { ok: false, reason, dms }.
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
  // They may have walked apart between the ask and the answer. The window is
  // still stamped — saying yes is saying yes — but nobody is attached to
  // somebody standing somewhere else.
  const together = actor.locationId && actor.locationId === target.locationId;

  await prisma.$transaction(async (tx) => {
    await tx.character.update({
      where: { id: target.id },
      data: {
        escortConsentToId: actor.id,
        escortConsentUntilTurn: turn.number + CONSENT_TURNS,
        ...(together ? { escortedById: actor.id } : {}),
      },
    });
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
          attached: Boolean(together),
        },
      },
    });
  });

  return {
    ok: true,
    line: together
      ? `You're with ${actor.name} now.`
      : `You agreed, but ${actor.name} isn't here any more.`,
    dms: actor.discordUserId
      ? [
          {
            discordUserId: actor.discordUserId,
            content: together
              ? `${target.name} is with you.`
              : `${target.name} agreed, but you've moved away.`,
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
  partyOf,
  attach,
  detach,
  createEscortOffer,
  acceptEscort,
};
