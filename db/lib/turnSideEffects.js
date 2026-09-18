// Everything the turn advance says out loud. The only place in the turn-advance path that talks to Discord — every resolveNeeds() pass hands
// back posts and DMs instead of sending them, so a 429 can never wedge a turn inside its transaction.
//
// This is its own module, with a ledger, because a killed process mid-fan-out must not strand or double-send anything: the payload is persisted
// (Turn.sideEffectPayload) and progress is recorded (Turn.sideEffectSteps), the same way resolveNeeds() persists Turn.resolvedPasses, because none
// of this is idempotent — re-running the loop below sends somebody a second notice telling them they died.
//
// ORDER IS LOAD-BEARING AND MUST NOT BE TIDIED. The fireball sits after the death loop so nobody reads that the sky is on fire before their own
// character has died. The feed watermark goes before the Discord wipe. The turret burst goes before the DMs telling people what it hit.
//
// Takes `prisma` as a parameter, stays off the @lifeweb/db barrel. Per-concern work lives in turnSideEffects/steps/*.js; what stays here is the
// ledger itself — the resume query, `step()`/`eachDm()`, and the fixed order the steps are called in — because that's what a resumed run reads.
const { sendEarlyDmNotices, sendLateDmNotices } = require("./turnSideEffects/steps/dmNotices");
const { announceTurretBursts } = require("./turnSideEffects/steps/turretBurst");
const { runDepotLines } = require("./turnSideEffects/steps/depot");
const { sendTurretAndBirdDms } = require("./turnSideEffects/steps/turretAndBird");
const { deliverCarryDrops } = require("./turnSideEffects/steps/carryDrops");
const { renameCatatonicRoles } = require("./turnSideEffects/steps/roleRenames");
const { handleDeaths } = require("./turnSideEffects/steps/death");
const { sendHungerNotices } = require("./turnSideEffects/steps/hunger");
const { applyRelocations } = require("./turnSideEffects/steps/relocations");
const { runXomOutcomes } = require("./turnSideEffects/steps/xom");
const { deliverStagedPrivate } = require("./turnSideEffects/steps/delivery");
const { runBroadcasts } = require("./turnSideEffects/steps/broadcasts");
const { deliverPublicPosts } = require("./turnSideEffects/steps/publicPosts");
const { wrapUpTurn } = require("./turnSideEffects/steps/turnWrapup");
const { expireTurnVantages } = require("./turnSideEffects/steps/vantages");

// Everything advanceTurn() has to hand over to be replayable in a process that never saw the turn resolve. Plain JSON only — no Prisma rows, no
// Dates, no functions. `messageWipeEnabled` is deliberately NOT captured: a resume should honour the switch as it stands now. `startedAtMs` is the
// cutoff for the message wipe — on a resumed run Date.now() is hours later, which would sweep away everything said in between.
function buildSideEffectPayload(fields) {
  return {
    startedAtMs: Date.now(),
    newTurnId: fields.newTurnId,
    // The day the CLOSING turn belonged to. The zone-summary wipe fires only when the new turn starts a new game-day, and a
    // resumed run has no other way to know — re-reading the last RESOLVED turn would give a different answer if a second
    // advance had landed in between.
    previousDayNumber: fields.previousDayNumber ?? null,
    note: fields.note ?? null,
    lessonDms: fields.lessonDms ?? [],
    researchDms: fields.researchDms ?? [],
    confessionDms: fields.confessionDms ?? [],
    trinketDms: fields.trinketDms ?? [],
    tagExpiryDms: fields.tagExpiryDms ?? [],
    turretBursts: fields.turretBursts ?? [],
    depotLocationId: fields.depotLocationId ?? null,
    depotLines: fields.depotLines ?? [],
    turretDms: fields.turretDms ?? [],
    birdNotices: fields.birdNotices ?? [],
    carryDrops: fields.carryDrops ?? [],
    catatonicDms: fields.catatonicDms ?? [],
    catatonicRoleUpdates: fields.catatonicRoleUpdates ?? [],
    catatonicDeathWarnings: fields.catatonicDeathWarnings ?? [],
    dyingDeathWarnings: fields.dyingDeathWarnings ?? [],
    catatonicDeaths: fields.catatonicDeaths ?? [],
    dyingDeaths: fields.dyingDeaths ?? [],
    nukeDeaths: fields.nukeDeaths ?? [],
    ascensionDeaths: fields.ascensionDeaths ?? [],
    turretDeaths: fields.turretDeaths ?? [],
    stagedDeaths: fields.stagedDeaths ?? [],
    hungerNotices: fields.hungerNotices ?? [],
    zoneMoves: fields.zoneMoves ?? [],
    xomDeaths: fields.xomDeaths ?? [],
    xomTeleports: fields.xomTeleports ?? [],
    xomConversations: fields.xomConversations ?? [],
    xomShouts: fields.xomShouts ?? [],
    privateDeliveries: fields.privateDeliveries ?? [],
    routineNotices: fields.routineNotices ?? [],
    gambitRollNotices: fields.gambitRollNotices ?? [],
    nukeBroadcast: fields.nukeBroadcast ?? null,
    ascensionBroadcast: fields.ascensionBroadcast ?? null,
    gameEndedPost: fields.gameEndedPost ?? null,
    publicPosts: fields.publicPosts ?? [],
  };
}

async function runTurnSideEffects(prisma, { turnId, payload }) {
  const p = payload ?? {};

  // This may run in a DIFFERENT DEPLOY than the one that wrote the payload — a key this build expects and that build never wrote must read as
  // "nothing to send", not throw halfway and strand the rest of the turn.
  const list = (v) => (Array.isArray(v) ? v : []);

  // Steps already sent, non-empty only after a previous run died part-way. Read fresh so a resume in another process sees what the first managed.
  const row = await prisma.turn.findUnique({
    where: { id: turnId },
    select: { sideEffectSteps: true },
  });
  const done = new Set(Array.isArray(row?.sideEffectSteps) ? row.sideEffectSteps : []);

  // One send, one key. A step that throws is left unrecorded so the next run retries it. The inner .catch()es below stay: they stop one dead
  // channel taking the rest of a loop with it, a different job from surviving a killed process.
  async function step(key, fn) {
    if (done.has(key)) return;
    try {
      await fn();
    } catch (err) {
      console.error(`Turn side effect "${key}" failed:`, err);
      return;
    }
    done.add(key);
    await prisma.turn
      .update({ where: { id: turnId }, data: { sideEffectSteps: [...done] } })
      .catch((err) => console.error(`Failed to record side effect "${key}":`, err));
  }

  // Index keys, not id keys: the payload is frozen on the row, so position is stable across runs.
  async function eachDm(prefix, items, send) {
    const each = list(items);
    for (let i = 0; i < each.length; i += 1) {
      await step(`${prefix}:${i}`, () => send(each[i]));
    }
  }

  // Cutoff for the message wipe, taken before the first Discord call so nothing posted by this thunk gets swept. See db/lib/messageWipe.js.
  const sideEffectsStartedAt = p.startedAtMs ?? Date.now();

  const ctx = { prisma, p, list, step, eachDm };

  // FIRST: the fog of war from yesterday goes out before anything below moves
  // anybody, so a relocation's own vantage is not swept by the same pass that
  // clears the old day's (db/lib/vantages.js).
  await expireTurnVantages(ctx);

  await sendEarlyDmNotices(ctx);

  // Before the DMs, so the zone hears the burst about when its targets are told what it did.
  await announceTurretBursts(ctx);

  // The Depot's own hardware speaking for itself.
  await runDepotLines(ctx);

  await sendTurretAndBirdDms(ctx);

  await deliverCarryDrops(ctx);

  // Catatonic suffix and disguise on/off, see turnSideEffects/steps/roleRenames.js.
  await renameCatatonicRoles(ctx);

  await handleDeaths(ctx);

  await sendHungerNotices(ctx);

  await applyRelocations(ctx);

  await runXomOutcomes(ctx);

  const deliveryFailures = [];

  // Staged-arbitration deliveries (docs/systemdocs/ADJUDICATION.md §1a).
  await deliverStagedPrivate(ctx, deliveryFailures);

  await sendLateDmNotices(ctx);

  await runBroadcasts(ctx);

  await deliverPublicPosts(ctx, deliveryFailures);

  await wrapUpTurn(ctx, sideEffectsStartedAt);

  // Only now is the turn's Discord half finished, which is what the resume query selects on.
  await prisma.turn
    .update({
      where: { id: turnId },
      data: { sideEffectsDoneAt: new Date(), sideEffectClaimedAt: null },
    })
    .catch((err) => console.error("Failed to stamp sideEffectsDoneAt:", err));
}

module.exports = { runTurnSideEffects, buildSideEffectPayload };
