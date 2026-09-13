// Answering a DM's buttons, from either face.
//
// The click used to land in the BOT only -- a DM has no guild, so every one of
// these handlers lived in bot/src/. Now the web answers them too
// (db/lib/dmActions.js says why), and the load, the ownership check and the
// order of the tail are the parts that must not drift between the two. So they
// live here, once, and each face keeps only what is genuinely its own.
//
// This is ARCHITECTURE.md §4 one level up: rather than being a function that
// returns its Discord work, it COMPOSES the per-kind db/lib functions that
// already do, and hands the whole pile back. The bot awaits it inline; the web
// defers it to after(), because awaiting Discord inside a server action
// freezes the app.
//
// What stays per-face, and why it cannot be lifted:
//   - interaction.update() taking the buttons off the DM. The web has no such
//     primitive; it re-renders the row instead.
//   - fetching a Discord User and sending: the bot has a gateway client, the
//     web has REST (the twin table in ARCHITECTURE.md §3).
//   - the nickname sync -- buildNickname exists once per face -- so only the
//     id to sync crosses back.
//   - room access and the carry drop, both Discord round trips that
//     web/lib/afterInventoryChange.js deliberately runs inside after().
//
// Takes `prisma` as a parameter and is NOT on the @lifeweb/db barrel; require
// it by path.
const { DM_ACTION, DM_CHOICE } = require("./dmActions");
const { acceptLesson, declineOffer } = require("./lessons");
const { acceptBind } = require("./bind");
const { acceptConfession } = require("./confession");
const { acceptKiss } = require("./kiss");
const { acceptEscort } = require("./escort");
const { acceptThreatSpawn, declineThreatSpawn } = require("./threatSpawn");
const { declineAssignment } = require("./lobby");
const { holdKeyedOpen } = require("./gates");
const { settleCarry } = require("./carry");
const { releaseHeldBy, seenAs, identityOf, IDENTITY_SELECT } = require("./intercept");
const { cancelAttack, ATTACK_CALLED_OFF_DM } = require("./attack");
const { recordArchiveEvent } = require("./archive");
const { refuseTax, payPartialTax } = require("./tax");

// Nothing to do, drawn as the reason under the message. Shared so the four
// families refuse in the same words.
const GONE = "That offer's gone.";
const NOT_YOURS = "That's not yours to answer.";

function empty(extra = {}) {
  return { dms: [], sideEffects: { spawn: null, nicknameSyncDiscordUserId: null, roomSyncCharacterIds: [], carryDrop: null, boundNotification: null, ...extra } };
}

// The Offer half's ownership check. Lifted from bot/src/lib/offers.js, where
// it was reachable only from a Discord interaction — the web had no way to
// borrow it and would have had to reinvent it.
async function loadOfferFor(prisma, offerId, discordUserId) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) return { problem: GONE };
  const responder = await prisma.character.findFirst({
    where: { id: offer.responderId, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true },
  });
  if (!responder || responder.discordUserId !== discordUserId) return { offer, problem: NOT_YOURS };
  return { offer, responder, problem: null };
}

// The post-bind tail, minus its Discord half. settleCarry is a pure Prisma
// write and belongs here; the drop's delivery and the room sync are round
// trips the caller runs its own twin of.
//
// Best-effort throughout and it never flips `ok` — a room nobody can enter is
// the channel doctor's problem, not a reason to tell somebody the bind they
// just accepted failed.
async function afterBind(prisma, boundId) {
  const out = { roomSyncCharacterIds: [], carryDrop: null, boundNotification: null };
  try {
    out.carryDrop = await settleCarry(prisma, boundId);
    out.roomSyncCharacterIds = [boundId];
    // The bound character's own id is what the caller needs to notify them —
    // bot/src/lib/offers.js used to re-query the row a second time for exactly
    // this, having already had boundId in hand.
    const target = await prisma.character.findUnique({ where: { id: boundId }, select: { discordUserId: true } });
    if (target?.discordUserId) out.boundNotification = { discordUserId: target.discordUserId, content: "Someone bound you." };
  } catch (err) {
    console.error(`Post-bind settle for ${boundId} failed:`, err);
  }
  return out;
}

async function answerOffer(prisma, { id, discordUserId, choice }) {
  const { offer, responder, problem } = await loadOfferFor(prisma, id, discordUserId);
  if (problem) return { ok: false, line: problem, ...empty() };

  const accepting = choice === DM_CHOICE.ACCEPT;
  const result = accepting
    ? offer.kind === "BIND"
      ? await acceptBind(prisma, offer, responder)
      : offer.kind === "CONFESSION"
        ? await acceptConfession(prisma, offer, responder)
        : offer.kind === "ESCORT"
          ? await acceptEscort(prisma, offer, responder)
          : offer.kind === "KISS"
            ? await acceptKiss(prisma, offer, responder)
            : await acceptLesson(prisma, offer, responder)
    : await declineOffer(prisma, offer, responder);

  const base = empty();
  base.dms = result.dms ?? [];
  if (result.ok && result.boundId) Object.assign(base.sideEffects, await afterBind(prisma, result.boundId));
  return { ok: result.ok, line: result.ok ? result.line : result.reason, ...base };
}

async function answerThreatSpawn(prisma, { id, discordUserId, choice }) {
  if (choice !== DM_CHOICE.ACCEPT) {
    const result = await declineThreatSpawn(prisma, id, discordUserId);
    return { ok: result.ok, line: result.ok ? result.line : result.reason, ...empty() };
  }

  const result = await acceptThreatSpawn(prisma, id, discordUserId);
  if (!result.ok) return { ok: false, line: result.reason, ...empty() };

  const out = empty({ spawn: result.sideEffects, nicknameSyncDiscordUserId: discordUserId });

  // A seat with a `brief` (the Thanati — db/lib/threats.js) says what it is
  // only NOW, to somebody who has accepted. A decline never reads the cult's
  // doctrine.
  if (result.threat.brief?.length) {
    out.dms.push({ discordUserId, content: result.threat.brief.join("\n") });
  }

  // Two independent try/catches on purpose: a failing archive write must not
  // suppress the audit row, and neither may cost a character that exists.
  try {
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "character_created",
        targetCharacterId: result.character.id,
        details: { threat: result.threat.name, spawn: true, role: result.character.roleTitle },
      },
    });
  } catch (err) {
    console.error("Threat spawn audit failed:", err);
  }
  try {
    await recordArchiveEvent(prisma, {
      kind: "CHARACTER_CREATED",
      character: result.character,
      zoneId: result.character.zoneId ?? null,
      turn: result.turn,
      content: `${result.character.name} arrived in Ravenheart as ${result.character.roleTitle}.`,
    });
  } catch (err) {
    console.error("Threat spawn archive failed:", err);
  }

  return { ok: true, line: result.line, character: result.character, ...out };
}

async function answerLobbySeat(prisma, { id, discordUserId }) {
  // One button, and it declines — accepting a seat is building the character.
  const result = await declineAssignment(prisma, id, discordUserId);
  return { ok: result.ok, line: result.ok ? result.line : result.reason, ...empty() };
}

// The Refuse click. One button, and it declines — there is no accept, the
// same LOBBY_SEAT shape as answerLobbySeat above.
async function answerPendingTax(prisma, { id, discordUserId, choice, amount }) {
  const result =
    choice === DM_CHOICE.PARTIAL
      ? await payPartialTax(prisma, { pendingTaxId: id, discordUserId, amount })
      : await refuseTax(prisma, { pendingTaxId: id, discordUserId });
  return { ok: result.ok, line: result.ok ? result.line : result.reason, ...empty() };
}

async function answerKeyedWay(prisma, { id, discordUserId, choice }) {
  const result = await holdKeyedOpen(prisma, { discordUserId, linkId: id, hold: choice === DM_CHOICE.ACCEPT });
  if (!result.ok) return { ok: false, line: result.error, ...empty() };
  return { ok: true, line: result.note ? `${result.line}\n-# ${result.note}` : result.line, ...empty() };
}

// Letting a prisoner go (docs/systemdocs/INTERCEPT.md). The odd one out of the
// family: every other kind here is a pending row somebody is being ASKED
// about, and this is the person who imposed a state ending it — so `id` is the
// person being held, and the clicker must be the one holding them.
// releaseHeldBy's WHERE is that check, which is why there is no ownership
// lookup of its own here.
async function answerInterceptHold(prisma, { id, discordUserId }) {
  const holder = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, name: true },
  });
  if (!holder) return { ok: false, line: NOT_YOURS, ...empty() };
  const freed = await releaseHeldBy(prisma, holder.id, { targetId: id });
  if (freed.length === 0) return { ok: false, line: "They're already free.", ...empty() };

  const target = freed[0];
  const dms = [];
  if (target.discordUserId && target.status === "ALIVE") {
    // Unattributed, the notifyCharacter posture (REQUESTS.md §3): they know
    // perfectly well who had hold of them, and the game does not need to
    // confirm it.
    dms.push({ discordUserId: target.discordUserId, content: "You've been let go. You can move again." });
  }
  return { ok: true, line: `You let ${target.name} go.`, ...empty(), dms };
}

// Breaking off a fight you started (docs/systemdocs/ATTACK.md). The same shape
// as the release above and the same rule — the initiator answers — but it
// cannot go through releaseHeldBy, because BOTH sides of a fight are held and
// only the Attack row knows whether either of them is still in another one.
// cancelAttack's WHERE is the ownership check.
async function answerAttackHold(prisma, { id, discordUserId }) {
  const attacker = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: { id: true, name: true },
  });
  if (!attacker) return { ok: false, line: NOT_YOURS, ...empty() };
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (!openTurn) return { ok: false, line: GONE, ...empty() };

  // By the face the room saw, never the row. The DM this button sits on says
  // "you ambushed a hooded figure"; answering it with their real name would
  // make the button the unmasking tool the whole verb refuses to be
  // (docs/systemdocs/ATTACK.md §6).
  const target = await prisma.character.findUnique({
    where: { id },
    select: { ...IDENTITY_SELECT, status: true },
  });
  const seen = target ? seenAs(identityOf(target)) : "them";
  const done = await cancelAttack(prisma, {
    attackerId: attacker.id,
    targetCharacterId: id,
    turnId: openTurn.id,
  });
  if (!done.ok) return { ok: false, line: "You aren't fighting them.", ...empty() };

  const dms = [];
  if (target?.discordUserId && target.status === "ALIVE") {
    dms.push({ discordUserId: target.discordUserId, content: ATTACK_CALLED_OFF_DM });
  }
  return { ok: true, line: `You break off from ${seen}.`, ...empty(), dms };
}

// The one entry point. `action` is the descriptor off DirectMessage.meta
// (db/lib/dmActions.js#dmActionOf); `discordUserId` is the CLICKER, resolved
// by the caller from its own session or interaction and never from anything
// the client posted.
//
// Always returns { ok, line, dms, sideEffects } — a refusal a player caused is
// never a throw, because the caller writes the reason under their own message.
// `line` carries the refusal too, never a separate `reason`: both faces print
// result.line unconditionally, so a refusal that answered on any other key
// would put a literal "undefined" in front of a player.
async function answerDmAction(prisma, { action, choice, discordUserId, amount }) {
  if (!discordUserId) return { ok: false, line: NOT_YOURS, ...empty() };
  const args = { id: action.id, discordUserId, choice, amount };
  switch (action.kind) {
    case DM_ACTION.OFFER:
      return answerOffer(prisma, args);
    case DM_ACTION.THREAT_SPAWN:
      return answerThreatSpawn(prisma, args);
    case DM_ACTION.LOBBY_SEAT:
      return answerLobbySeat(prisma, args);
    case DM_ACTION.KEYED_WAY:
      return answerKeyedWay(prisma, args);
    case DM_ACTION.INTERCEPT_HOLD:
      return answerInterceptHold(prisma, args);
    case DM_ACTION.ATTACK_HOLD:
      return answerAttackHold(prisma, args);
    case DM_ACTION.PENDING_TAX:
      return answerPendingTax(prisma, args);
    default:
      return { ok: false, line: GONE, ...empty() };
  }
}

module.exports = { answerDmAction, loadOfferFor };
