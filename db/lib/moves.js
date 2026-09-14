// Filing a Move, on either face — the Action row and every gate in front of it: the open turn, the move window, the one-Move-a-turn rule, the incapacitation block and Labor's rate.
// Writes no Discord and composes no confirmation: the bot's `confirmMove` still writes the DM's lines, and the web renders its own. Returns the Action plus the labor rate when there is one.
// A filed Move is FINAL — you get one Move and it stands. Only a GM changes a filed Move, from /gm/dev. Old `move_edited` rows stay in the audit log.
const { moveWindow } = require("./turnClock");
const { clockFrozen } = require("./gameState");
const { blockerFor, ACT } = require("./incapacitation");
const { resolveLaborRate } = require("./laborAccess");
const { touchCharacterActivity } = require("./characterActivity");

const MOVE_KINDS = new Set(["ROUTINE", "GAMBIT", "LABOR"]);
const DESCRIPTION_MAX = 2000;

// `character` needs { id, zoneId, locationId, discordUserId }.
async function fileMove(prisma, { character, actorDiscordUserId, moveKind, description }) {
  if (!character) return { ok: false, error: "You don't have a living character." };
  if (!MOVE_KINDS.has(moveKind)) return { ok: false, error: "Pick a kind of Move first." };

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
  const heldTags = await prisma.characterTag.findMany({
    where: { characterId: character.id },
    select: { tag: { select: { slug: true, name: true } } },
  });
  const stuck = blockerFor(heldTags, ACT);
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

module.exports = {
  MOVE_KINDS,
  DESCRIPTION_MAX,
  fileMove,
};
