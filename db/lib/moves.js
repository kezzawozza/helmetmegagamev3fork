// Filing a Move, on either face — the Action row and every gate in front of it: the open turn, the move window, the one-Move-a-turn rule, the incapacitation block and Labor's rate.
// Writes no Discord and composes no confirmation: the bot's `confirmMove` still writes the DM's lines, and the web renders its own. Returns the Action plus the labor rate when there is one.
// A Gambit stays yours until lock-in: `editMove` rewrites it, `withdrawMove` takes it back and hands the turn over. Everything else a player files is a RECEIPT for something that already happened, and is final the moment it lands.
// That is safe only because the d6 moved off submit and onto the cutoff (db/lib/gambitCutoff.js). While the die was rolled here, an uncapped edit was a re-roll button — flip Gambit → Routine → Gambit and fish for a better one. Nothing to fish for now: the roll happens once, after the window shuts, and no edit can reach it.
const { moveWindow } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { blockerFor, gambitBlockerFor, ACT } = require("./incapacitation");
const { resolveLaborRate } = require("./laborAccess");
const { touchCharacterActivity } = require("./characterActivity");
const { deleteActionRestoringTurn, lockIsLive, syncQuestIntention } = require("./moveEconomy");
const { attacksBy } = require("./attack");

// Every kind the column may hold. ROUTINE is still written constantly — by the auto-labor pass, by every button that spends a Move, by a GM reclassifying from the desk — it just stopped being a kind a PLAYER picks.
const MOVE_KINDS = new Set(["ROUTINE", "GAMBIT", "LABOR"]);
// What the modal and the Move dialog may submit. A Routine was "easy, it resolves itself", which is now simply what the game calls anything you didn't write.
const PLAYER_MOVE_KINDS = new Set(["GAMBIT", "LABOR"]);
const DESCRIPTION_MAX = 2000;

// `character` needs { id, zoneId, locationId, discordUserId }.
async function fileMove(prisma, { character, actorDiscordUserId, moveKind, description }) {
  if (!character) return { ok: false, error: "You don't have a living character." };
  if (!PLAYER_MOVE_KINDS.has(moveKind)) return { ok: false, error: "Pick a kind of Move first." };

  const raw = String(description ?? "").trim();
  if (!raw) return { ok: false, error: "Write something first." };
  if (raw.length > DESCRIPTION_MAX) return { ok: false, error: "That's too long." };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return { ok: false, error: "Your turn isn't open — your Move wasn't recorded." };

  // Re-checked here, not just where the dialog opened — a form can sit open across the cutoff. Before the Action row, so a refusal costs no turn.
  const { locked } = moveWindow(openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (locked) return { ok: false, error: "Moves for this turn are locked." };

  const alreadyActed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (alreadyActed) {
    return { ok: false, error: "You've already locked in a Move this turn — this one wasn't recorded." };
  }

  // The same gate every other action runs (db/lib/incapacitation.js). Checked after the already-acted test so a refusal costs nothing, and before the Action row so a refused Move never lands on the desk.
  // A Gambit gets the narrower gate: Bound, Crucified or Catatonic can still take a long shot; only Unconscious, Paralyzed, Seizure or Dying stop one.
  const heldTags = await prisma.characterTag.findMany({
    where: { characterId: character.id },
    select: { tag: { select: { slug: true, name: true } } },
  });
  const stuck = moveKind === "GAMBIT" ? gambitBlockerFor(heldTags) : blockerFor(heldTags, ACT);
  if (stuck) {
    return { ok: false, error: `You can't act right now — you're ${stuck.name}. Nothing was recorded.` };
  }

  let resourceRollExpression = null;
  let laborRate = null;
  if (moveKind === "LABOR") {
    laborRate = await resolveLaborRate(prisma, character.id);
    if (!laborRate.ok) return { ok: false, error: `${laborRate.reason}` };
    resourceRollExpression = laborRate.expression;
  }
  // Stamped once here — see Action.laborTier's comment in schema.prisma for why this is never recomputed later.
  const laborTier = laborRate?.tier ?? null;

  // @@unique([characterId, turnId]) is the real gate; a retried submit at rollover must not become a second Move.
  let action;
  try {
    action = await prisma.action.create({
      data: {
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "PENDING_TYPE",
        moveKind,
        // The one place this is ever true. It is what makes a Gambit editable and withdrawable below.
        playerFiled: true,
        description: raw,
        resourceDelta: null,
        resourceRollExpression,
        laborTier,
        zoneId: character.zoneId ?? null,
        // Stamped at filing time — a free zone move costs no Action, so by turn close they may be standing somewhere else.
        locationId: character.locationId ?? null,
      },
    });
  } catch (err) {
    if (err.code === "P2002") return { ok: false, error: "You've already acted this turn." };
    throw err;
  }

  await touchCharacterActivity(prisma, character.id);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: actorDiscordUserId ?? character.discordUserId ?? null,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      // Three per-turn rations COUNT audit rows (REQUESTS.md §1a), so every row gets its turn stamped even when nothing reads it yet.
      turnId: openTurn.id,
      details: { actionId: action.id, kind: moveKind, tier: laborRate?.tier ?? null },
    },
  });

  return { ok: true, action, laborRate, openTurn };
}

// Pure, so every branch is testable without a database or a clock — the same shape db/lib/oracleCutoff.js uses, and for the same reason: all but one branch is a refusal, and a refusal the player can't read is a bug report.
// `action` needs { playerFiled, moveKind, moveReviewStatus, lockExpiresAt, diceRoll }. A null action means nothing is filed, which is not an error anywhere — the caller decides whether that's "file one" or "nothing to withdraw".
function moveIsEditable(action, openTurn, { now = new Date(), clockFrozen = false } = {}) {
  if (!action) return { editable: false, reason: "no Move was declared" };
  // THE die guard, and it is the one that actually has to hold. Everything below is about
  // when the window shuts; this is about the thing the window protects. A thrown die must
  // never be thrown twice — withdrawing a rolled Gambit and filing another would hand back
  // a fresh one, which is the exact prize this whole design removes.
  if (action.diceRoll != null) return { editable: false, reason: "the die is already thrown" };
  // A receipt. Bury, craft, torture, travel, a lesson, the labor you already got paid for — the thing happened, so there is nothing left to take back.
  if (!action.playerFiled) return { editable: false, reason: "the game declared this one for you" };
  // Labor pays the moment it's filed, so by the time it exists it is a receipt too. Withdraw is a Gambit's alone.
  if (action.moveKind !== "GAMBIT") return { editable: false, reason: "only a Gambit can be changed" };
  if (action.moveReviewStatus !== "OPEN") return { editable: false, reason: "a GM has already settled this Move" };
  // A GM holding the row on the desk. Rare — they work the desk after the lock — but a player editing out from under an open adjudication is exactly the race the lock exists to stop.
  if (lockIsLive(action, now)) return { editable: false, reason: "a GM is looking at this Move right now" };
  if (!openTurn) return { editable: false, reason: "no turn is open" };
  // Deliberately NOT `locked`. That flag is false on BOTH sides of the window — before the
  // cutoff, and again once a turn outlives its derived end because an advance was missed
  // (turnClock.js says so outright, and the Oracle wants that reopening). Reading it here
  // would reopen editing on an overdue turn whose dice were thrown hours ago. What matters
  // is only whether the cutoff has passed.
  const { cutoffAt, hasLock } = moveWindow(openTurn, { now, clockFrozen });
  if (hasLock && now.getTime() >= cutoffAt.getTime()) {
    return { editable: false, reason: "Moves for this turn are locked" };
  }
  return { editable: true, reason: "yours until the lock" };
}

// Loads what moveIsEditable needs, and refuses for the player's own reason rather than a generic one.
async function loadEditableMove(prisma, { character, actionId }) {
  if (!character) return { ok: false, error: "You don't have a living character." };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  // NO `include: { character: true }`, deliberately. deleteActionRestoringTurn runs
  // travelClaimsToUndo (db/lib/locationTravel.js), which reads the character's
  // zoneMoves* columns and refunds a claimed crossing — and with the character absent it
  // correctly returns null. That is right here, because a player's Gambit never claims a
  // crossing. Add the include and withdrawing becomes a free-travel refund: cross a zone
  // (no Action filed), file a Gambit, take it back, and the crossings come back.
  const action = await prisma.action.findFirst({
    where: { characterId: character.id, ...(actionId ? { id: actionId } : {}), ...(openTurn ? { turnId: openTurn.id } : {}) },
  });
  // The WHERE is the ownership check: another character's actionId simply doesn't match.
  if (!action) return { ok: false, error: "That Move isn't yours." };

  const { editable, reason } = moveIsEditable(action, openTurn, { clockFrozen: await clockFrozen(prisma) });
  if (!editable) return { ok: false, error: `You can't change this Move — ${reason}.` };

  return { ok: true, action, openTurn };
}

// Rewrite a pending Gambit. Kind is deliberately NOT editable: switching to Labor pays out on the spot, and a function that both edits and pays is two functions. Withdraw and file again.
async function editMove(prisma, { character, actorDiscordUserId, actionId, description }) {
  const raw = String(description ?? "").trim();
  if (!raw) return { ok: false, error: "Write something first." };
  if (raw.length > DESCRIPTION_MAX) return { ok: false, error: "That's too long." };

  const loaded = await loadEditableMove(prisma, { character, actionId });
  if (!loaded.ok) return loaded;
  const { action, openTurn } = loaded;

  if (raw === action.description) return { ok: true, action, unchanged: true };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.action.update({ where: { id: action.id }, data: { description: raw } });
    await syncQuestIntention(tx, action.id, raw);
    return row;
  });

  await touchCharacterActivity(prisma, character.id);
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: actorDiscordUserId ?? character.discordUserId ?? null,
      actionType: "move_edited",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: { actionId: action.id, from: action.description, to: raw },
    },
  });

  return { ok: true, action: updated };
}

// Take a pending Gambit back and get the turn returned. Deleting the row IS the refund — every turn-economy check looks for any Action on the open turn (db/lib/moveEconomy.js).
// Returns the DMs owed to anyone whose lesson Offer died with it; the caller sends them, since db/lib writes no Discord.
async function withdrawMove(prisma, { character, actorDiscordUserId, actionId }) {
  const loaded = await loadEditableMove(prisma, { character, actionId });
  if (!loaded.ok) return loaded;
  const { action, openTurn } = loaded;

  // Attack is free and pins BOTH sides for the day, and its gate (db/lib/combatGate.js) lets
  // you press it only because a Gambit is still an unspent turn — "you should only Attack if
  // you plan to use your Gambit to actually declare your combat". That gate is checked once,
  // when the fight is declared. Withdrawing the Gambit afterwards would walk straight out
  // from under it: file a Gambit, pin somebody all day, take it back, file a Labor, and
  // collect a paid day's work on top of a held opponent.
  // Break off is never gated (ATTACK.md §5a), so this refusal always has a way out.
  const fights = await attacksBy(prisma, character.id, openTurn.id);
  if (fights.length > 0) {
    const names = fights.map((f) => f.name).join(", ");
    return {
      ok: false,
      error: `You're still fighting ${names}. Break off first, then you can take this back.`,
    };
  }

  let dms = [];
  await prisma.$transaction(async (tx) => {
    dms = await deleteActionRestoringTurn(tx, action);
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actorDiscordUserId ?? character.discordUserId ?? null,
        actionType: "move_withdrawn",
        targetCharacterId: character.id,
        turnId: openTurn.id,
        details: { actionId: action.id, description: action.description, moveKind: action.moveKind },
      },
    });
  });

  await touchCharacterActivity(prisma, character.id);

  return { ok: true, dms, description: action.description };
}

module.exports = {
  MOVE_KINDS,
  PLAYER_MOVE_KINDS,
  DESCRIPTION_MAX,
  fileMove,
  editMove,
  withdrawMove,
  moveIsEditable,
};
