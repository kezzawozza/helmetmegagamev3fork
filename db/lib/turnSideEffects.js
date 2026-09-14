// Everything the turn advance says out loud. The only place in the
// turn-advance path that talks to Discord — every resolveNeeds() pass hands
// back posts and DMs instead of sending them, so a 429 can never wedge a turn
// inside its transaction.
//
// WHY THIS IS ITS OWN MODULE, AND WHY IT HAS A LEDGER. It used to be a closure
// inside advanceTurn(), holding thirty arrays in one process's memory with no
// record anywhere that it had run. On 2026-09-08 the bomb went off at the
// close of turn 3, the database half committed perfectly — twelve dead, the
// game ended, all of it logged — and a redeploy landed twenty-eight seconds
// later and SIGTERM'd the container mid-fan-out. Three of twelve death DMs got
// out. The fireball and the Game Ended post never did, and nothing on earth
// was going to retry them: resolveNeeds() stamps Turn.needsResolvedAt before
// this thunk is even built, so as far as the resume query was concerned that
// turn was finished.
//
// So the payload is persisted (Turn.sideEffectPayload) and the progress is
// recorded (Turn.sideEffectSteps), exactly the way resolveNeeds() persists
// Turn.resolvedPasses one layer down, and for exactly the same reason: none of
// this is idempotent. Re-running the loop below sends somebody a second notice
// telling them they died.
//
// ORDER IS LOAD-BEARING AND MUST NOT BE TIDIED. The fireball sits after the
// death loop so nobody reads that the sky is on fire before their own
// character has died. The feed watermark goes before the Discord wipe. The
// turret burst goes before the DMs telling people what it hit.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel — the
// db/lib/dm.js convention; require it by path.
//
// The actual per-concern work lives in turnSideEffects/steps/*.js, one module
// per comment-delimited section this file used to hold inline (DM notices,
// the Depot, role renames, deaths, relocations, Xom, staged deliveries,
// broadcasts, public posts, the turn-close wrap-up). What stays here is the
// ledger itself — the resume query, `step()`/`eachDm()`, and the fixed order
// the steps are called in — because that's what a resumed run actually reads.
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

// Everything advanceTurn() has to hand over for this to be replayable in a
// process that never saw the turn resolve. Plain JSON only — no Prisma rows,
// no Dates, no functions. `newTurnId` rather than the row, and
// `messageWipeEnabled` is deliberately NOT captured: a resume should honour
// the switch as it stands now.
//
// `startedAtMs` is the one that bites if you forget it. It is the cutoff for
// the message wipe, and on a resumed run Date.now() is hours later — which
// would sweep away everything said in between.
function buildSideEffectPayload(fields) {
  return {
    startedAtMs: Date.now(),
    newTurnId: fields.newTurnId,
    note: fields.note ?? null,
    autoLaborDms: fields.autoLaborDms ?? [],
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
    travelArrivals: fields.travelArrivals ?? [],
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

  // The whole point of this function is that it runs in a process that did not
  // write the payload — which may mean a DIFFERENT DEPLOY of it. A key this
  // build expects and that build never wrote must read as "nothing to send",
  // not throw halfway and strand the rest of the turn.
  const list = (v) => (Array.isArray(v) ? v : []);

  // Steps already sent — non-empty only when a previous run of this thunk
  // died part-way. Read fresh from the row rather than trusted from a caller,
  // so a resume in another process sees what the first one managed.
  const row = await prisma.turn.findUnique({
    where: { id: turnId },
    select: { sideEffectSteps: true },
  });
  const done = new Set(Array.isArray(row?.sideEffectSteps) ? row.sideEffectSteps : []);

  // One send, one key. A step that throws is left unrecorded, so the next run
  // retries it — the same bargain resolveNeeds() strikes with a failed pass.
  // The inner .catch()es below stay where they are: they stop one dead channel
  // taking the rest of a loop with it, which is a different job from surviving
  // a killed process.
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

  // Index keys, not id keys: the payload is frozen on the row, so position is
  // stable across runs, and two notices to the same person stay distinct.
  async function eachDm(prefix, items, send) {
    const each = list(items);
    for (let i = 0; i < each.length; i += 1) {
      await step(`${prefix}:${i}`, () => send(each[i]));
    }
  }

  // Cutoff for the message wipe below, taken before the first Discord call so
  // nothing posted by this thunk gets swept. See db/lib/messageWipe.js.
  const sideEffectsStartedAt = p.startedAtMs ?? Date.now();

  // The one bundle every step below reads — never widened per step, each one
  // just destructures what it needs off it.
  const ctx = { prisma, p, list, step, eachDm };

  await sendEarlyDmNotices(ctx);

  // A gun going off is heard well past the room it is in. Before the DMs
  // below rather than after, so the zone hears the burst at about the moment
  // the people it hit are told what it did to them.
  await announceTurretBursts(ctx);

  // The Depot's hardware, speaking for itself: the generator dying and the
  // shuttle leaving on its own clock are both things the room witnesses.
  await runDepotLines(ctx);

  await sendTurretAndBirdDms(ctx);

  await deliverCarryDrops(ctx);

  // Two things want to rename a personal role in a turn — the Catatonic
  // suffix, and a disguise coming on or off — see turnSideEffects/steps/roleRenames.js.
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

  // Only now is the turn's Discord half actually finished, which is what the
  // resume query selects on.
  await prisma.turn
    .update({
      where: { id: turnId },
      data: { sideEffectsDoneAt: new Date(), sideEffectClaimedAt: null },
    })
    .catch((err) => console.error("Failed to stamp sideEffectsDoneAt:", err));
}

module.exports = { runTurnSideEffects, buildSideEffectPayload };
