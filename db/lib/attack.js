// ATTACKING SOMEBODY (docs/systemdocs/ATTACK.md). You press it on somebody standing with you and neither of you goes anywhere: both are held where you are until the turn ends and a GM reads what you filed. Nothing here RESOLVES a fight — that's a Gambit and a GM's ruling, the posture COMBAT.md sets and this doesn't touch.
// The hold is Intercept's hold, not a second one — intercept.js owns Character.heldUntil and every gate that reads it, this module only writes it. An Ambush that fires files one of these too, so an ambush and an attack are one thing in one queue.
// This module takes `db` as a parameter and is deliberately NOT on the @lifeweb/db barrel (dm.js convention); require it by path. IT SENDS NOTHING — like fireWatches, it returns DM descriptors and the caller sends them after the transaction commits (ARCHITECTURE.md §5).
const { fightingSkill, bandRank, FIGHTING_TAG_FIELDS } = require("./fightingSkill");
const { turnEndsAt } = require("./turnClock");
const { SAFE_HOLD_MS, HELD_REASON, seenAs, identityOf, IDENTITY_SELECT } = require("./intercept");
const { hoodToken } = require("./hoodToken"); // zero-require leaf; no cycle.
const { DM_KIND } = require("./dmKinds");
const { DM_ACTION, dmAction } = require("./dmActions");

// How far above you somebody may be before the button refuses. The one tunable in this file. BANDS, not points, and that's load-bearing: floor:/cap: tags move the band index AFTER points are summed (fightingSkill.js), so a bound Expert still scores 55 and only their band knows they're Pitiful — comparing scores would let a tied-up champion refuse to be attacked. Bands are ten points wide with every rung dead centre, so two bands is two tiers.
// Why the gate exists: without it anybody can freeze anybody for a whole day, and a bum stops the Tribunal Ordinator by walking up to them. Not meant to stop a hard fight, only a hopeless one.
const MAX_BAND_GAP = 2;

// Bascinet's words, verbatim.
const TOO_STRONG = "This opponent is too strong to attack.";

// The Tag columns anything asking this question must select. Miss one and the gate silently reads everybody as Weak at that surface only — the discipline FIGHTING_TAG_FIELDS states for itself.
const ATTACK_TAG_SELECT = {
  where: { quantity: { gt: 0 } },
  select: { equipped: true, tag: { select: { ...FIGHTING_TAG_FIELDS, slug: true } } },
};

// The better of somebody's two halves. An archer and a swordsman are each judged on what they're actually good at — the only reading that doesn't make a marksman a free target for anybody with a knife.
function bestBandRank(characterTags) {
  const resolved = fightingSkill(characterTags ?? []);
  return Math.max(bandRank(resolved.melee.band.key), bandRank(resolved.ranged.band.key));
}

// PURE, and the whole gate. Returns the refusal sentence or null. Both arguments are CharacterTag rows selected with ATTACK_TAG_SELECT. Only the gap upward is checked — attacking somebody far below you isn't something the game has any business refusing, a bad thing to do not an impossible one, and the GM reads it either way.
function attackRefusal(attackerTags, targetTags) {
  const gap = bestBandRank(targetTags) - bestBandRank(attackerTags);
  return gap > MAX_BAND_GAP ? TOO_STRONG : null;
}

// An attack runs to the end of the turn, so the turn advance frees everybody for free and nothing sweeps. Never SHORTER than a Safe intercept, though — turnEndsAt is the boundary after the turn STARTED, so a turn the cron hasn't closed on time would otherwise put the deadline in the past and hold nobody. The intercept.js#fireWatches reasoning, verbatim.
function attackHoldUntil(openTurn, now = new Date()) {
  const boundary = turnEndsAt(openTurn);
  const floor = new Date(now.getTime() + SAFE_HOLD_MS);
  return boundary && boundary > floor ? boundary : floor;
}

// AN HOUR, NOT A TURN. A turn is a whole real day, so "attacking is permanent for the turn" meant that calling a fight off — the decent thing to do when the scene moves on — spent your only shot at that person until tomorrow, and the game answered the next press with "you're already fighting them" about a fight nobody was in. The unique still stands and the row is still never deleted (ATTACK.md §2); a cancelled row is now a cooling-off period rather than a headstone, and after the hour it is REOPENED in place. Still one row per pair per turn, so nothing that counts fights or draws them learns a new shape.
// Hardcoded rather than a GameConfig knob, the db/lib/bell.js posture: one rule, one right answer. Long enough that nobody can hound one person all afternoon — the thing the old rule existed to stop — short enough that a fight which restarts for a real reason can restart.
const ATTACK_COOLDOWN_MS = 60 * 60 * 1000;

// PURE, the bell.js shape. `cancelledAt` null means nothing to wait for.
function attackCooldown(cancelledAt, now = Date.now()) {
  if (!cancelledAt) return { ok: true, secondsLeft: 0 };
  const elapsed = now - new Date(cancelledAt).getTime();
  if (elapsed >= ATTACK_COOLDOWN_MS) return { ok: true, secondsLeft: 0 };
  return { ok: false, secondsLeft: Math.ceil((ATTACK_COOLDOWN_MS - elapsed) / 1000) };
}

// Everyone still in a live fight with this character, either end of it. The one query the settle below runs, and the reason one person backing out of a three-way brawl doesn't unpick the whole thing.
function liveAttackWhere(characterId, turnId) {
  return {
    turnId,
    cancelledAt: null,
    OR: [{ attackerId: characterId }, { targetCharacterId: characterId }],
  };
}

// Re-derive one person's hold from the fights they're actually still in. Called for every side of every attack that ends, however it ends. It CLEARS or it RE-POINTS — never just clears, and the re-point is the half that matters: heldById names one opponent, and a brawl has several — A and C both attack B, then A breaks off; B stays held, correctly, but heldById still says A, who's now in no fight at all. Leave that stale and the next thing that clears "everyone A is holding" (A walking away, A dying) frees B out of C's fight. So the pointer moves to somebody who's really still there.
// Known and small: a two-minute Safe intercept hold that an attack overwrote isn't restored when the attack is called off. Tracking that would want a second column for two minutes of a stranger's afternoon, a worse trade than the gap.
async function settleHold(db, characterId, turnId) {
  const still = await db.attack.findMany({
    where: liveAttackWhere(characterId, turnId),
    select: { attackerId: true, targetCharacterId: true },
  });
  if (still.length === 0) {
    await db.character.updateMany({
      where: { id: characterId, heldReason: { in: [HELD_REASON.ATTACK, HELD_REASON.ATTACKING] } },
      data: { heldUntil: null, heldById: null, heldReason: null },
    });
    return { held: false };
  }
  // Being jumped outranks doing the jumping: somebody in both positions at once should read the sentence about the fight they didn't choose.
  const jumped = still.find((row) => row.targetCharacterId === characterId);
  const row = jumped ?? still[0];
  const opponent = jumped ? row.attackerId : row.targetCharacterId;
  await db.character.updateMany({
    where: { id: characterId, heldReason: { in: [HELD_REASON.ATTACK, HELD_REASON.ATTACKING] } },
    data: { heldById: opponent, heldReason: jumped ? HELD_REASON.ATTACK : HELD_REASON.ATTACKING },
  });
  return { held: true };
}

// BOTH sides, each held BY THE OTHER, each with its OWN reason — you don't start a fight and stroll off, but the jumped and the jumper must not read the same sentence off every shut way, and heldReason is the only thing that tells them apart. Conditional on the clock (the fireWatches rule): a hold already running longer than this one is left exactly where it is.
// One copy on purpose: a fresh attack and a reopened one hold identically, and the clock rule above is too subtle to keep in two places.
async function holdBothSides(db, { attacker, target, until }) {
  for (const [who, by, reason] of [
    [target.id, attacker.id, HELD_REASON.ATTACK],
    [attacker.id, target.id, HELD_REASON.ATTACKING],
  ]) {
    await db.character.updateMany({
      where: { id: who, OR: [{ heldUntil: null }, { heldUntil: { lt: until } }] },
      data: { heldUntil: until, heldById: by, heldReason: reason },
    });
  }
}

// `attacker` and `target` are rows selected with intercept.js#IDENTITY_SELECT. The strength gate is the CALLER's business, not this function's — an ambush files one of these and is deliberately not gated (you set a watch blind).
// Returns { ok, already, cooldownSecondsLeft, dms }. A unique violation is not an error — it means these two already have a row this turn, and the row decides which of three things that is: a live fight (`already`, refuse, unchanged), a break-off still inside its hour (`cooldownSecondsLeft`, refuse with the wait), or a cooled-off one, which is REOPENED in place rather than re-created. See ATTACK_COOLDOWN_MS above.
async function fileAttack(db, { attacker, target, openTurn, fromAmbush = false, locationId = null, now = new Date() }) {
  const until = attackHoldUntil(openTurn, now);
  const where = { attackerId: attacker.id, targetCharacterId: target.id, turnId: openTurn.id };
  const place = locationId ?? target.locationId ?? null;

  try {
    await db.attack.create({
      data: { ...where, fromAmbush: Boolean(fromAmbush), locationId: place },
    });
  } catch (err) {
    if (err?.code !== "P2002") throw err;

    const existing = await db.attack.findUnique({
      where: { attackerId_targetCharacterId_turnId: where },
      select: { id: true, cancelledAt: true },
    });
    // No row behind the clash: something else owns that unique, and refusing the old way is the honest answer.
    if (!existing || existing.cancelledAt === null) return { ok: false, already: true, dms: [] };

    const cool = attackCooldown(existing.cancelledAt, now.getTime());
    if (!cool.ok) return { ok: false, already: false, cooldownSecondsLeft: cool.secondsLeft, dms: [] };

    // The same fight resuming, so `createdAt` is left alone — when these two first came to blows this turn is what a GM reads it for. Where and how it started are re-stamped, because a reopened fight may begin somewhere else or out of an ambush this time.
    await db.attack.update({
      where: { id: existing.id },
      data: { cancelledAt: null, fromAmbush: Boolean(fromAmbush), locationId: place },
    });
  }

  await holdBothSides(db, { attacker, target, until });
  return { ok: true, already: false, until, dms: attackDms({ attacker, target, fromAmbush }) };
}

// Only the attacker may. `where` is the ownership check (the releaseHeldBy posture) — no second lookup to disagree with it. The row is stamped, never deleted: breaking off is final for the turn, and a deleted row would hand the unique back and let somebody attack the same person all afternoon.
async function cancelAttack(db, { attackerId, targetCharacterId, turnId }) {
  const done = await db.attack.updateMany({
    where: { attackerId, targetCharacterId, turnId, cancelledAt: null },
    data: { cancelledAt: new Date() },
  });
  if (done.count === 0) return { ok: false };
  await settleHold(db, targetCharacterId, turnId);
  await settleHold(db, attackerId, turnId);
  return { ok: true };
}

// Every fight this character is in, on either side, ended at once — and both sides of each settled. Two callers, the two ways a fight stops without anybody choosing: a RELOCATION (locationMove.js — a GM teleport, Bulk Move, staged Relocate to, rite; walking off never reaches it, since a held character can't walk) or a DEATH (characterDeath.js — both ends: a dead attacker holds nobody, a dead target isn't held; leaving the far half live would strand the survivor, since settleHold would keep finding that row and refuse to let go for the rest of the turn).
// intercept.js#releaseHeldBy deliberately cannot do this itself: it works off heldById, and only the row knows whether either side is still in another fight. Looks the open turn up itself (the cancelWatchOnMove shape) — the callers of that function have no turn in hand.
async function closeFightsFor(db, characterId) {
  if (!characterId) return { closed: 0 };
  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (!openTurn) return { closed: 0 };

  const live = await db.attack.findMany({
    where: liveAttackWhere(characterId, openTurn.id),
    select: { id: true, attackerId: true, targetCharacterId: true },
  });
  if (live.length === 0) return { closed: 0 };

  await db.attack.updateMany({
    where: { id: { in: live.map((row) => row.id) } },
    data: { cancelledAt: new Date() },
  });
  const touched = new Set();
  for (const row of live) {
    touched.add(row.attackerId);
    touched.add(row.targetCharacterId);
  }
  for (const id of touched) await settleHold(db, id, openTurn.id);
  return { closed: live.length };
}

// Every live fight this character started, for the sheet's cancel list.
async function attacksBy(db, attackerId, turnId) {
  if (!turnId) return [];
  const rows = await db.attack.findMany({
    where: { attackerId, turnId, cancelledAt: null },
    include: { targetCharacter: { select: IDENTITY_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  // By the face the room saw, never the row — the intercept.js rule, and it matters as much here: attacking a hooded stranger must not unmask them.
  //
  // That rule reaches the ID as well as the name. This list goes to a browser, and /api/avatar/<id>
  // answers with a face, so a hooded opponent carries an HMAC token in place of their id — otherwise
  // swinging at a stranger would be the cheapest unmasking in the game, which is exactly what
  // matchesArrival() refuses to let Intercept be. `key` is what a caller posts back; `id` stays null
  // for a hood so nothing can accidentally reach past it.
  return rows.map((row) => {
    const presented = identityOf(row.targetCharacter);
    const token = presented?.concealed ? hoodToken(row.targetCharacter.id) : null;
    return {
      id: token ? null : row.targetCharacter.id,
      key: token ? `hood:${token}` : `character:${row.targetCharacter.id}`,
      name: seenAs(presented),
    };
  });
}

const ATTACK_CANCEL_PREFIX = "atk:cancel:";

function attackCancelRow(targetId, label) {
  return [
    {
      type: 1,
      components: [{ type: 2, style: 2, custom_id: `${ATTACK_CANCEL_PREFIX}${targetId}`, label: label.slice(0, 80) }],
    },
  ];
}

const ATTACK_CALLED_OFF_DM = "The fight is off. You can move again.";

// An ambush already says its own thing on the way in (fireWatches), so it carries no second victim line — only the attacker's, which is where the Cancel button lives.
function attackDms({ attacker, target, fromAmbush }) {
  const dms = [];
  const attackerSeen = seenAs(identityOf(attacker));
  const targetSeen = seenAs(identityOf(target));

  if (!fromAmbush && target.discordUserId) {
    dms.push({
      discordUserId: target.discordUserId,
      content: `${attackerSeen} attacked you. You can't move until the end of the turn. Make a Gambit declaring your intent!`,
      kind: DM_KIND.NOTICE,
    });
  }
  if (attacker.discordUserId) {
    dms.push({
      discordUserId: attacker.discordUserId,
      content: fromAmbush
        ? `You successfully ambushed ${targetSeen}. Neither of you can move until the turn ends.`
        : `You attacked ${targetSeen}. Neither of you can move until the turn ends.`,
      kind: DM_KIND.NOTICE,
      components: attackCancelRow(target.id, "Cancel attack"),
      meta: dmAction(DM_ACTION.ATTACK_HOLD, target.id),
    });
  }
  return dms;
}

module.exports = {
  MAX_BAND_GAP,
  TOO_STRONG,
  ATTACK_TAG_SELECT,
  ATTACK_CANCEL_PREFIX,
  ATTACK_CALLED_OFF_DM,
  ATTACK_COOLDOWN_MS,
  bestBandRank,
  attackRefusal,
  attackCooldown,
  fileAttack,
  cancelAttack,
  closeFightsFor,
  attacksBy,
};
