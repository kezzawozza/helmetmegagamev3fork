// Shared Prisma client for the bot, the web app, and every script. Strips
// stray .env quotes from DATABASE_URL before @prisma/client is required,
// since the generated client snapshots its datasource env at load time.
function normalizedDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  const unquoted = raw.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  if (unquoted !== raw) process.env.DATABASE_URL = unquoted;
  return unquoted;
}

const databaseUrl = normalizedDatabaseUrl();

const { PrismaClient, Prisma } = require("@prisma/client");
// By path, off the barrel — the scripts that need it most are ad-hoc ones.
const { assertRawSqlAllowed } = require("./lib/localDatabase");
const { buildTurnAnnouncement } = require("./turnCalendar");
const { nextTurnBanner } = require("./lib/turnBanner");
// The turn's Discord half, and the ledger that lets a killed one be finished.
const {
  runTurnSideEffects,
  buildSideEffectPayload,
} = require("./lib/turnSideEffects");
const { expiryFrom } = require("./lib/turnFormat");
const { runCorpseRotPass } = require("./lib/corpseRotPass");
const { runStructureYieldPass } = require("./lib/structureYieldPass");
const { runArelitzLayPass } = require("./lib/arelitzLayPass");
const { reconcileCorpses } = require("./lib/corpseFollow");
const { runTravelArrivalPass } = require("./lib/travelArrivalPass");
const { runTagExpiryPass } = require("./lib/tagExpiryPass");
const { runHungerPass } = require("./lib/hungerPass");
const { runCarryPass } = require("./lib/carryPass");
const { runMoodPass } = require("./lib/moodPass");
const { runDawnAfflictionPass } = require("./lib/dawnAfflictionPass");
const { runXomPass } = require("./lib/xomPass");
const { runDepotPass } = require("./lib/depotPass");
const { runGatehouseTurretPass } = require("./lib/gatehouseTurret");
const { getGameState, readGameState } = require("./lib/gameState");
const { runCatatonicPass } = require("./lib/catatonicPass");
const { runCatatonicDeathPass } = require("./lib/catatonicDeathPass");
const { runVisionDecayPass } = require("./lib/visionDecayPass");
const { runDyingDeathPass } = require("./lib/dyingDeathPass");
const { runNukeExplosionPass } = require("./lib/nukeExplosionPass");
const { runAscensionPass } = require("./lib/ascensionPass");
const { endGameInDb } = require("./lib/gameEnd");
const { runBirdPass } = require("./lib/birdPass");
const { runHorseUpkeepPass } = require("./lib/horseUpkeepPass");
const { runAutoLaborPass } = require("./lib/autoLaborPass");
const { runLaborYieldPass } = require("./lib/laborYield");
const { runStagedPushPass } = require("./lib/stagedPush");
const { runTaxPass } = require("./lib/taxPass");
const { releaseUnresolvedCavingRolls } = require("./lib/cavingPass");
const { runLessonPass } = require("./lib/lessonPass");
const { runResearchPass } = require("./lib/researchPass");
const { runConfessionPass } = require("./lib/confessionPass");
// Required by path, not through the barrel: see db/lib/dm.js for why there
// are three same-named sendDm exports with three signatures.
const { sendDm } = require("./lib/dm");
const { recordArchiveMessage, recordArchiveEvent } = require("./lib/archive");
const { loadForcedName } = require("./lib/presentedIdentity");
const { postAsCharacter, attachBreakerStore } = require("./lib/discordRest");
const { bumpBlood, LIFEWEB_SPUTTER_THRESHOLD } = require("./lib/lifeweb");
const { runFullChannelWipe } = require("./lib/fullWipe");
const { syncZonesFromYaml } = require("./lib/syncZones");
const { syncTagsFromYaml } = require("./lib/syncTags");
const { deleteCharacterRow } = require("./lib/deleteCharacter");
const { syncRolesFromYaml } = require("./lib/syncRoles");
const { syncDesiresFromYaml } = require("./lib/syncDesires");
const { syncDocumentsFromYaml } = require("./lib/syncDocuments");
const { syncLaborDropsFromYaml } = require("./lib/syncLaborDrops");
const {
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
} = require("./lib/specialChannels");
const { syncSpecialChannels } = require("./lib/syncSpecialChannels");

const globalForPrisma = globalThis;

// Cached unconditionally (not gated on NODE_ENV): Turbopack bundles this
// module into two separate chunks/registries in the web build, and gating
// the cache meant two PrismaClients per container. transactionOptions raises
// Prisma's defaults (2s/5s) because the per-character transactions in
// db/lib/autoLaborPass.js compete for pool slots at turn rollover.
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
    transactionOptions: { maxWait: 5000, timeout: 15000 },
    // Character.avatarData is a 10-25 KB blob served out-of-band by the
    // avatar route; omitting it globally stops it riding along on every
    // `include`. An explicit `select: { avatarData: true }` still overrides.
    omit: { character: { avatarData: true } },
  })
    // TRUNCATE and DROP cannot reach a database that is not local, from
    // anywhere, through this client. On 2026-09-09 a throwaway regression
    // harness truncated seven tables on the LIVE database and emptied the
    // game. It had a .env naming a local Postgres sitting right beside it —
    // but DATABASE_URL was already exported in the shell, and dotenv does not
    // override a variable that is already set, so every "local" run was
    // production and said nothing. .claude/hooks/db-guard.py could not have
    // caught it either: that hook matches a fixed list of known scripts, and
    // an ad-hoc file is on no list.
    //
    // So the check lives here, where nothing has to opt in. It costs nothing
    // real — every TRUNCATE/DROP in the repo is migration SQL, which the
    // Prisma CLI applies without this client — and it holds inside
    // $transaction, which a hand-wrapped method would not.
    // See db/lib/localDatabase.js.
    .$extends({
      query: {
        $queryRaw: ({ args, query }) => (assertRawSqlAllowed(args, databaseUrl), query(args)),
        $executeRaw: ({ args, query }) => (assertRawSqlAllowed(args, databaseUrl), query(args)),
        $queryRawUnsafe: ({ args, query }) => (assertRawSqlAllowed(args, databaseUrl), query(args)),
        $executeRawUnsafe: ({ args, query }) => (assertRawSqlAllowed(args, databaseUrl), query(args)),
      },
    });

globalForPrisma.prisma = prisma;

// The mood dial DMs a player when they drop into Afraid or Panicking, from
// hooks deep inside tag writes that have no DM plumbing of their own. Hand it
// the logged REST sender once, here, where both faces load the client
// (db/lib/mood.js).
require("./lib/mood").setMoodDmSender((discordUserId, content) => sendDm(prisma, discordUserId, content));

// Hands the Discord circuit breaker somewhere durable to keep its counters.
// discordRest.js has no prisma dependency (this file requires IT), so the
// two functions are passed in rather than required back.
attachBreakerStore({
  read: () =>
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: {
        restInvalidCount: true,
        restInvalidWindowStart: true,
        restBreakerOpenUntil: true,
      },
    }),
  // updateMany, not update: on a brand-new database GameConfig may not exist
  // yet, and a rate-limit count shouldn't create it as a side effect.
  write: (data) => prisma.gameConfig.updateMany({ where: { id: 1 }, data }),
});

// The stackable half of resolveNeeds()' expiry sweep: each expired stack
// loses one unit and the remainder's clock restarts from the tag's catalog
// duration, so a stack sheds one unit at a time rather than all at once.
// `model` is "characterTag" or "roomTag": a stack lying in a Room sheds
// exactly the way one in a pocket does (docs/systemdocs/CARRY.md).
//
// No tag today is BOTH stackable and equippable and carries a
// defaultDurationTurns, so this can never yet shed a unit out from under
// CharacterTag.equippedQuantity — decrementing the row this way, unlike
// dropCharacterTag / tagWrites.js#clampEquippedQuantity, does not clamp it.
// The day a tag combines all three, this needs the same clamp those do.
async function sweepExpiredStacks(turn, model = "characterTag") {
  const expired = await prisma[model].findMany({
    where: { expiresTurn: { lte: turn.number }, tag: { stackable: true } },
    select: {
      id: true,
      quantity: true,
      poisonedCount: true,
      tag: { select: { defaultDurationTurns: true } },
    },
  });
  if (expired.length === 0) return;

  const spent = [];
  // new expiresTurn -> rows landing on it
  const rescheduled = new Map();
  for (const ct of expired) {
    if (ct.quantity <= 1) {
      spent.push(ct.id);
      continue;
    }
    const next = expiryFrom(turn.number + 1, ct.tag.defaultDurationTurns ?? 1);
    if (!rescheduled.has(next)) rescheduled.set(next, []);
    rescheduled.get(next).push(ct);
  }

  // Poison clamp (fix round M4b, fix 7): the decrement below shrinks
  // quantity by exactly 1 without touching poisonedCount, which — one expiry
  // at a time — can walk poisonedCount above the new quantity, the same
  // invariant (0 <= poisonedCount <= quantity, payload null at 0) every
  // other decrement path in tagWrites.js already enforces. A full
  // hypergeometric draw here would be over-engineering: nothing today mints
  // a poisoned stack that carries its OWN expiresTurn (poison rides on food
  // and drink, whose clock the consume ladder tracks separately), so this
  // branch never actually fires — the clamp is a belt-and-suspenders guard
  // on a path that is, for now, unreachable.
  const poisonClamps = [...rescheduled.values()]
    .flat()
    .filter((ct) => ct.poisonedCount > ct.quantity - 1)
    .map((ct) => {
      const newQuantity = ct.quantity - 1;
      return prisma[model].updateMany({
        where: { id: ct.id },
        data: {
          poisonedCount: newQuantity,
          ...(newQuantity <= 0 ? { poisonPayload: null } : {}),
        },
      });
    });

  await prisma.$transaction([
    ...(spent.length
      ? [prisma[model].deleteMany({ where: { id: { in: spent } } })]
      : []),
    // decrement, not a computed literal, so a concurrent grant on the same
    // row can't be clobbered between the read above and this write.
    ...[...rescheduled].map(([expiresTurn, cts]) =>
      prisma[model].updateMany({
        where: { id: { in: cts.map((ct) => ct.id) } },
        data: { quantity: { decrement: 1 }, expiresTurn },
      }),
    ),
    ...poisonClamps,
  ]);
}

// Applies per-turn Needs decay to the turn being closed, shared by the bot's
// cron advance and the GM dashboard's manual close-turn. Returns Discord work
// (posts/DMs) for the caller's runSideEffects() rather than sending it here.
const TURN_PASSES = [
  "autoLabor",
  "lessons",
  // Research (db/lib/researchPass.js): same slot as Lessons, and right after
  // it for the same reason lessons follows autoLabor — after only because it
  // shares the slot, not because either depends on the other's result.
  "research",
  "confessions",
  "stagedPush",
  // What a filed tax collects (db/lib/taxPass.js). Right after stagedPush
  // (a GM's own adjudication outranks a player verb) and before
  // horseUpkeep/hunger — a tax is the same kind of levy, and can push
  // someone into Hunger, matching horseUpkeepPass.js's own "the animal eats
  // before the rider does."
  "tax",
  "tagExpiry",
  // Counts Damaged Vision stacks and turns 5 of them into Blind. After
  // tagExpiry so a stack that grew this turn is counted, before the sweep so
  // the rows it deletes are its own. See db/lib/visionDecayPass.js.
  "visionDecay",
  "dyingDeath",
  // ASCENSION BEFORE THE BOMB, deliberately. Both can come due on one close,
  // and the rite is called off by its leader dying — so with the bomb first
  // the blast killed that leader and the cult silently lost a game it had won.
  // Ascension still sits after the staged push and dyingDeath, so a leader
  // killed by another character this turn does stop it; only the blast, which
  // is simultaneous rather than earlier, no longer does.
  "ascension",
  "nukeExplosion",
  // Corpses turn before the sweep, and the order is load-bearing: the sweep
  // is a blind deleteMany over expiresTurn, so a body that reached its clock
  // would be deleted instead of rotting. See db/lib/corpseRotPass.js.
  "corpseRot",
  "expirySweep",
  // After the sweep, and it has nothing to do with it: a notice is on a board
  // rather than on a sheet, so nothing above can see one.
  "noticeboard",
  "catatonic",
  "catatonicDeath",
  "bird",
  // The horse's feed. Immediately BEFORE hunger, and the order is
  // load-bearing: auto-labor has already paid the day's income, and the animal
  // eats before the rider does — a character down to their last ⬢ feeds the
  // horse and goes Hungry. See db/lib/horseUpkeepPass.js.
  "horseUpkeep",
  "hunger",
  // Guilt Ridden and Insomniac's nightly chance of waking Exhausted. After
  // hunger so it sees the final sheet. See db/lib/dawnAfflictionPass.js.
  "dawnAfflictions",
  // The god of chance and disorder collects. Every holder of
  // {tag:old-ways-xom} rolls once on a weighted table that can hand out a tag,
  // a corpse's worth of rats, a teleport, a scream, or a death. AFTER the
  // expiry sweep, or the timed tags it grants would be swept the moment they
  // landed; BEFORE carry, which has to weigh what it handed out, and before
  // mood, which pays the night wherever it left somebody standing. See
  // db/lib/xomPass.js.
  "xom",
  "carry",
  // The mood dial's nightly settle: the place each character sleeps in, the
  // drift back toward Fine, hunger, a body in the room, a noble's missed
  // dinner. After hunger (it reads the final streak) and carry (the final
  // sheet). It used to matter that this ran before travelArrival, so a
  // traveller paid the night where they set out from; travel lands at once
  // now, so a crosser simply pays the night wherever they ended the day
  // standing. See db/lib/moodPass.js and docs/systemdocs/MOOD.md.
  "mood",
  // After "carry", because the overflow drop can put a corpse on a floor.
  // Pull-based, so it just re-reads where every body's tag ended up.
  "corpseFollow",
  // The map's own weather. Late on purpose: it must land AFTER "autoLabor" so
  // a day is paid at the coefficients that were live during it, and what this
  // writes is what the next turn's labor is worth.
  "laborYield",
  "lifewebDecay",
  // What the buildings MAKE (db/lib/structureYieldPass.js). Late, and after
  // "carry" in particular: the pour lands on a Room's floor, so it must not
  // happen before the overflow drop that may already be putting things there.
  // Nothing above reads a stash, so nothing above can see it.
  "structureYield",
  // What Arelitz LAY (db/lib/arelitzLayPass.js). Same reasoning as
  // structureYield just above, and for the same reason it sits right after
  // it: the egg lands on a Room's floor for a stashed Arelitz, so it must not
  // run before "carry"'s own overflow drop might already be putting things
  // there.
  "arelitzLay",
  // The Depot's hardware: the generator burns a turn of fuel, the shuttle's
  // six-turn clock runs out, and the turret sweeps whoever is standing in the
  // room. Last, so the turret fires on the sheet everything else left behind —
  // in particular the armour the carry pass may have made someone drop.
  "depot",
  // The Gatehouse gun, for the same reason and in the same breath. Separate
  // from "depot" so a failed Depot pass cannot swallow it, and so a resume
  // re-runs exactly the one that did not finish.
  "gatehouseTurret",
  // A DRAIN (db/lib/travelArrivalPass.js). Nothing files work for this any
  // more — every crossing lands the moment it is made. It stays LAST, and
  // stays at all, only to land anybody who was mid-journey when the deferral
  // was removed; after that it matches nobody. Delete it once they have.
  "travelArrival",
];

// How long a resume lease is honoured before another advance may take it
// over — long enough not to steal a live resume, short enough that a killed
// process doesn't wedge the turn.
const RESUME_LEASE_MS = 30 * 60 * 1000;

async function resolveNeeds(turn, config) {
  // Passes already applied — non-empty only when a previous advance died
  // part-way through. See Turn.resolvedPasses in the schema.
  const done = new Set(
    Array.isArray(turn.resolvedPasses) ? turn.resolvedPasses : [],
  );

  async function markDone(name) {
    done.add(name);
    await prisma.turn
      .update({ where: { id: turn.id }, data: { resolvedPasses: [...done] } })
      .catch((err) =>
        console.error(`Failed to record completed pass "${name}":`, err),
      );
  }

  // A failed pass leaves the turn advancing anyway, logged and left
  // unrecorded so the next advance retries it.
  async function passFailed(name, err) {
    console.error(`${name} pass failed:`, err);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "turn_pass_failed",
          details: {
            turnNumber: turn.number,
            pass: name,
            error: String(err?.message ?? err),
          },
        },
      })
      .catch((logErr) =>
        console.error(
          "Failed to log turn_pass_failed — this failure now has no record:",
          logErr,
        ),
      );
  }

  // Auto-labor first: income has to land before Hunger's upkeep charge, and it
  // must run while the turn is still the one being closed. It also has to run
  // BEFORE the yield drift pass below, so a day's payouts use the coefficients
  // that were live during that day.
  let autoLabor = null;
  if (!done.has("autoLabor")) {
    autoLabor = await runAutoLaborPass(prisma, turn).catch(async (err) => {
      await passFailed("Auto-labor", err);
      return null;
    });
    if (autoLabor) await markDone("autoLabor");
  }
  const { dms: autoLaborDms = [], ...autoLaborSummary } = autoLabor ?? {};
  if (autoLabor?.filed) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "auto_labor_resolved",
          details: autoLaborSummary,
        },
      })
      .catch((err) => console.error("Auto-labor audit log failed:", err));
  }

  // Lessons (db/lib/lessonPass.js): the learner's Gambit is SOLVED here,
  // before the push closes it, and PENDING offers expire. After autoLabor
  // only so a learner who never accepted still worked their day.
  let lessons = null;
  if (!done.has("lessons")) {
    lessons = await runLessonPass(prisma, turn).catch(async (err) => {
      await passFailed("Lessons", err);
      return null;
    });
    if (lessons) await markDone("lessons");
  }
  const { dms: lessonDms = [], ...lessonSummary } = lessons ?? {};
  if (lessons && (lessons.resolved || lessons.expired || lessons.failed)) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "lessons_resolved",
          details: lessonSummary,
        },
      })
      .catch((err) => console.error("Lessons audit log failed:", err));
  }

  // Research (db/lib/researchPass.js): a filed research Gambit is SOLVED
  // here, same slot as Lessons and right after it. The D5 ledger row
  // (research_revealed) is written inside the pass itself, per character,
  // not here — this summary row is only the turn-wide tally.
  let research = null;
  if (!done.has("research")) {
    research = await runResearchPass(prisma, turn).catch(async (err) => {
      await passFailed("Research", err);
      return null;
    });
    if (research) await markDone("research");
  }
  const { dms: researchDms = [], ...researchSummary } = research ?? {};
  if (research && (research.resolved || research.failed)) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "research_resolved",
          details: researchSummary,
        },
      })
      .catch((err) => console.error("Research audit log failed:", err));
  }

  // Confessions (db/lib/confessionPass.js): same slot and the same reason as
  // lessons, and AFTER them, because the lesson pass is what expires every
  // PENDING offer on the turn — confessions included.
  let confessions = null;
  if (!done.has("confessions")) {
    confessions = await runConfessionPass(prisma, turn).catch(async (err) => {
      await passFailed("Confessions", err);
      return null;
    });
    if (confessions) await markDone("confessions");
  }
  const { dms: confessionDms = [], ...confessionSummary } = confessions ?? {};
  if (confessions && (confessions.resolved || confessions.failed)) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "confessions_resolved",
          details: confessionSummary,
        },
      })
      .catch((err) => console.error("Confessions audit log failed:", err));
  }

  // The staged-arbitration push (db/lib/stagedPush.js). Slot is
  // load-bearing: after autoLabor (which stamps appliedEffects), before
  // tagExpiry/expirySweep (a staged grant/cure must land first), and before
  // hunger (deferred Routine/Labor income must land before upkeep).
  let stagedPush = null;
  if (!done.has("stagedPush")) {
    stagedPush = await runStagedPushPass(prisma, turn).catch(
      async (err) => {
        await passFailed("Staged push", err);
        return null;
      },
    );
    if (stagedPush) await markDone("stagedPush");
  }
  const {
    privateDeliveries = [],
    publicPosts = [],
    zoneMoves = [],
    routineNotices = [],
    gambitRollNotices = [],
    ...stagedPushSummary
  } = stagedPush ?? {};
  if (stagedPush) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "staged_push_resolved",
          details: {
            turnNumber: turn.number,
            ...stagedPushSummary,
            privateMessages: privateDeliveries.length,
            publicPosts: publicPosts.length,
            routineNotices: routineNotices.length,
            gambitRollNotices: gambitRollNotices.length,
          },
        },
      })
      .catch((err) => console.error("Staged push audit log failed:", err));
  }

  // What a filed tax collects (db/lib/taxPass.js). See TURN_PASSES's own
  // comment on "tax" above for why it sits exactly here.
  if (!done.has("tax")) {
    const taxed = await runTaxPass(prisma, turn).catch(async (err) => {
      await passFailed("Tax", err);
      return null;
    });
    if (taxed) {
      await markDone("tax");
      if (taxed.applied > 0 || taxed.skipped > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "taxes_collected",
              details: taxed,
            },
          })
          .catch((err) => console.error("Tax audit log failed:", err));
      }
    }
  }

  // The caving release (db/lib/cavingPass.js). Directly after the staged push,
  // because the push is the GM's last chance to have resolved one by hand: a
  // TROUBLE roll still open once the turn closes holds its caver in the zone
  // forever, and the Caving lens is read-only on a past turn. So anything left
  // is resolved automatically here and the hold lifts.
  if (!done.has("cavingRelease")) {
    const released = await releaseUnresolvedCavingRolls(prisma, turn).catch(async (err) => {
      await passFailed("Caving release", err);
      return null;
    });
    if (released) await markDone("cavingRelease");
  }

  // Sweeps turn-scoped tag expiry. Progression runs first (grants what an
  // expiring tag turns into), then the sweep deletes exactly what it read.
  // See db/lib/tagExpiryPass.js.
  let progressed = null;
  if (!done.has("tagExpiry")) {
    progressed = await runTagExpiryPass(prisma, turn).catch(async (err) => {
      await passFailed("Tag expiry", err);
      return null;
    });
    if (progressed) await markDone("tagExpiry");
  }
  const { dms: tagExpiryDmsFromProgression = [], ...tagExpirySummary } =
    progressed ?? {};
  const tagExpiryDms = [...tagExpiryDmsFromProgression];
  if (progressed) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "tag_expiry_resolved",
          details: tagExpirySummary,
        },
      })
      .catch((err) => console.error("Tag expiry audit log failed:", err));
  }

  // Moonshine's slow bill. Rides the tagExpiry DM channel rather than
  // threading a variable of its own through runSideEffects — it is the same
  // kind of notice, "a tag on your sheet became a different tag".
  let visionDecay = null;
  if (!done.has("visionDecay")) {
    visionDecay = await runVisionDecayPass(prisma, turn).catch(async (err) => {
      await passFailed("Vision decay", err);
      return null;
    });
    if (visionDecay) await markDone("visionDecay");
  }
  if (visionDecay) {
    tagExpiryDms.push(...(visionDecay.dms ?? []));
    if (visionDecay.blinded > 0) {
      const { dms: _visionDms, ...visionSummary } = visionDecay;
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "vision_decay_resolved",
            details: visionSummary,
          },
        })
        .catch((err) => console.error("Vision decay audit log failed:", err));
    }
  }

  // Dying death — the engine's second auto-kill, run down from the Dying
  // tag's one-turn clock. After stagedPush/tagExpiry, before the sweep.
  // See db/lib/dyingDeathPass.js.
  let dyingDeath = null;
  if (!done.has("dyingDeath")) {
    dyingDeath = await runDyingDeathPass(prisma, turn).catch(async (err) => {
      await passFailed("Dying death", err);
      return null;
    });
    if (dyingDeath) await markDone("dyingDeath");
  }
  const {
    deaths: dyingDeaths = [],
    warnings: dyingDeathWarnings = [],
    ...dyingDeathSummary
  } = dyingDeath ?? {};
  if (dyingDeath) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "dying_deaths_resolved",
          details: dyingDeathSummary,
        },
      })
      .catch((err) => console.error("Dying death audit log failed:", err));
  }

  // The Rite of Ascension. After the staged push and dyingDeath, so a leader
  // killed by another character this turn calls it off — and BEFORE the bomb,
  // which is the tiebreak when both doomsdays come due on one close. With the
  // bomb first, its blast killed the cult's leader and the rite cancelled
  // itself, so the cult always lost a race it had already won.
  // See db/lib/ascensionPass.js.
  let ascension = null;
  if (!done.has("ascension")) {
    ascension = await runAscensionPass(prisma, turn).catch(async (err) => {
      await passFailed("Ascension", err);
      return null;
    });
    if (ascension) await markDone("ascension");
  }
  const {
    broadcast: ascensionBroadcast = null,
    deaths: ascensionDeaths = [],
    ...ascensionSummary
  } = ascension ?? {};
  // Declared here, with the first of the two endings, and shared with the
  // bomb below: whichever fires first writes the epilogue, and endGameInDb is
  // a no-op on a state that is already ENDED.
  let gameEndedPost = null;
  if (ascension?.fired || ascension?.cancelled) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: ascension.fired ? "ascension_fired" : "ascension_cancelled",
          details: ascensionSummary,
        },
      })
      .catch((err) => console.error("Ascension audit log failed:", err));
  }
  // The second way a game ends. Unlike the bomb it kills nobody — there is
  // simply nothing left to play in, so the clock stops and the archive opens.
  // Running before the bomb means that when both land together the epilogue
  // is the cult's; the blast still kills everyone above ground either way.
  if (ascension?.fired) {
    try {
      const ended = await endGameInDb(prisma, {
        closingNote: `The cult ascended at the end of turn ${turn.number}. Ravenheart was destroyed.`,
        reason: "ascension",
      });
      if (ended.ended) gameEndedPost = ended.post;
    } catch (err) {
      console.error("Ending the game after the ascension failed:", err);
    }
  }

  // The bomb. Sits here for the reason dyingDeath sits here: after the staged
  // push and tagExpiry, so a Disarm filed this turn (or a GM defusing it from
  // /gm/dev) beats the clock, and before the sweep, with its siblings.
  // See db/lib/nukeExplosionPass.js.
  let nukeExplosion = null;
  if (!done.has("nukeExplosion")) {
    nukeExplosion = await runNukeExplosionPass(prisma, turn).catch(async (err) => {
      await passFailed("Nuke explosion", err);
      return null;
    });
    if (nukeExplosion) await markDone("nukeExplosion");
  }
  const {
    deaths: nukeDeaths = [],
    broadcast: nukeBroadcast = null,
    ...nukeSummary
  } = nukeExplosion ?? {};
  // The bomb ends the game (docs/systemdocs/LOBBY.md §7): the clock stops
  // after this advance, the archive opens, and the reveal follows the
  // fireball into #turns. The new turn still opens below so the banner has
  // somewhere to hang. Ended locks only the clock — the survivors in the
  // caves keep playing until the wipe.
  if (nukeExplosion?.detonated) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "nuke_detonated",
          details: nukeSummary,
        },
      })
      .catch((err) => console.error("Nuke audit log failed:", err));
    try {
      const ended = await endGameInDb(prisma, {
        closingNote: `The device went off at the end of turn ${turn.number}. Everyone above ground died.`,
        reason: "nuke",
      });
      if (ended.ended) gameEndedPost = ended.post;
    } catch (err) {
      console.error("Ending the game after the detonation failed:", err);
    }
  }

  // The Bird's stranded letters (db/lib/birdPass.js), after both auto-kills
  // so a sender who died this turn is already dead when the notice composes.
  let birdResult = null;
  if (!done.has("bird")) {
    birdResult = await runBirdPass(prisma, turn).catch(async (err) => {
      await passFailed("Bird", err);
      return null;
    });
    if (birdResult) await markDone("bird");
  }
  const { notices: birdNotices = [], ...birdSummary } = birdResult ?? {};
  if (birdResult && birdSummary.undelivered > 0) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "bird_messages_undelivered",
          details: birdSummary,
        },
      })
      .catch((err) => console.error("Bird audit log failed:", err));
  }

  // Bodies turn. Must precede the sweep below — see db/lib/corpseRotPass.js.
  if (!done.has("corpseRot")) {
    const rot = await runCorpseRotPass(prisma, turn).catch(async (err) => {
      await passFailed("Corpse rot", err);
      return null;
    });
    if (rot) {
      await markDone("corpseRot");
      if (rot.rotted > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "corpses_rotted",
              details: rot,
            },
          })
          .catch((err) => console.error("Corpse rot audit log failed:", err));
      }
    }
  }

  if (!done.has("expirySweep")) {
    try {
      await prisma.characterTag.deleteMany({
        where: { expiresTurn: { lte: turn.number }, tag: { stackable: false } },
      });
      await sweepExpiredStacks(turn);
      // A stashed tag sheds on the same clock. The one progression that
      // reaches a floor is the corpse rot above, which has already nulled
      // expiresTurn on anything it turned, so this cannot see it.
      await prisma.roomTag.deleteMany({
        where: { expiresTurn: { lte: turn.number }, tag: { stackable: false } },
      });
      await sweepExpiredStacks(turn, "roomTag");

      // A worn-off disguise takes its catalog row with it. The row is minted
      // per disguise (db/lib/disguiseMint.js) and nothing else will ever hold
      // it, so leaving it behind is an orphan waiting for the next Restart
      // Game — the accumulation Tag.ephemeral exists to stop, exactly as the
      // noticeboard block below says. It also matters functionally: Tag.name
      // is @unique, so an orphan "Disguised (John)" would burn that alias for
      // the rest of the game.
      //
      // `ephemeral` AND the slug prefix, so this can never reach a catalog
      // tag, and `characters: { none: {} }` so a row still on somebody's sheet
      // is left alone — the deleteMany above only cleared the ones that
      // actually expired. Also guards against deleting a live disguise if this
      // pass is ever re-run out of order.
      await prisma.tag.deleteMany({
        where: {
          ephemeral: true,
          slug: { startsWith: "custom-disguise-" },
          characters: { none: {} },
          roomTags: { none: {} },
        },
      });
      // The same sweep, for the same reason, over cooked dishes
      // (docs/systemdocs/COOKING.md). Every distinct combination of words and
      // ingredients mints a row, and a busy kitchen makes a lot of them: a
      // cook who names each night's dinner leaves one behind per night, and
      // the eaten ones are held by nobody within a turn. Guarded identically
      // — `ephemeral` and the slug prefix so it can never reach a catalog
      // row, and `characters`/`roomTags` empty so a dish still in somebody's
      // pack or on a shelf is left where it is.
      //
      // Three guards the disguise sweep above does not need, because a custom
      // craft can go places a disguise never does.
      //
      // A pending OFFER may name a row nobody currently holds, and an Offer is
      // a real foreign key, so deleting under it would throw. A CraftProject
      // names its base recipe rather than a mint today, but it is the same
      // shape of pin and costs nothing to rule out.
      //
      // A CRATE is the one that is not a foreign key at all, and it is why
      // this query cannot be a `where` clause alone: packageItemsRequest
      // writes the packed items into `Tag.crateContents` as plain JSON and
      // then drops the CharacterTag rows outright. A crated dish therefore
      // has no holder, no room, no offer and no project — and sweeping it
      // would empty the crate silently, since opening one skips a tagId that
      // no longer resolves. Read every live manifest and exclude what they
      // name. There are a handful of crates in a game, so this is cheap.
      //
      // A swept row leaves a dangling id in old `request_craft_tag` audit
      // details. Accepted: `details.tagName` is recorded beside it, so a GM
      // reading the row still sees what was made.
      const crates = await prisma.tag.findMany({
        where: { crateContents: { not: Prisma.DbNull } },
        select: { crateContents: true },
      });
      const crated = new Set();
      for (const { crateContents } of crates) {
        if (!Array.isArray(crateContents)) continue;
        for (const line of crateContents) if (line?.tagId) crated.add(line.tagId);
      }
      await prisma.tag.deleteMany({
        where: {
          ephemeral: true,
          slug: { startsWith: "custom-craft-" },
          characters: { none: {} },
          roomTags: { none: {} },
          offers: { none: {} },
          craftProjects: { none: {} },
          ...(crated.size ? { id: { notIn: [...crated] } } : {}),
        },
      });
      await markDone("expirySweep");
    } catch (err) {
      await passFailed("Expiry sweep", err);
    }
  }

  // Noticeboards. A paper nobody took down blows away, and it takes the paper
  // with it — that is what expiring MEANS here, and it is why a notice is
  // worth tearing down rather than leaving. See docs/systemdocs/PAPERWORK.md.
  //
  // The Tag row goes too. Nothing else can reference it (NoticePost.tagId is
  // @unique, and the paper left its holder's sheet when it went up), so
  // leaving it would be an orphan waiting for the next Restart Game — which
  // is exactly the accumulation Tag.ephemeral was added to stop.
  if (!done.has("noticeboard")) {
    try {
      const blown = await prisma.noticePost.findMany({
        where: { expiresTurn: { lte: turn.number } },
        select: { id: true, tagId: true },
      });
      if (blown.length > 0) {
        const ids = blown.map((p) => p.id);
        const tagIds = blown.map((p) => p.tagId);
        await prisma.noticePost.deleteMany({ where: { id: { in: ids } } });
        // Only the runtime paper rows, never a catalog tag that somehow found
        // its way onto a board — `ephemeral` is the whole guard.
        await prisma.tag.deleteMany({
          where: { id: { in: tagIds }, ephemeral: true },
        });
      }
      await markDone("noticeboard");
    } catch (err) {
      await passFailed("Noticeboards", err);
    }
  }

  // Catatonic (AFK), checked against GameConfig.catatonicTurns. See
  // db/lib/catatonicPass.js.
  let catatonic = null;
  if (!done.has("catatonic")) {
    catatonic = await runCatatonicPass(prisma, turn).catch(async (err) => {
      await passFailed("Catatonic", err);
      return null;
    });
    if (catatonic) await markDone("catatonic");
  }
  const {
    dms: catatonicDms = [],
    roleUpdates: catatonicRoleUpdates = [],
    ...catatonicSummary
  } = catatonic ?? {};
  if (catatonic) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "catatonic_resolved",
          details: catatonicSummary,
        },
      })
      .catch((err) => console.error("Catatonic audit log failed:", err));
  }

  // Catatonic death — the engine's one auto-kill from inactivity. Its own
  // pass (not a branch of the one above) so a resume can't half-kill.
  // See db/lib/catatonicDeathPass.js.
  let catatonicDeath = null;
  if (!done.has("catatonicDeath")) {
    catatonicDeath = await runCatatonicDeathPass(prisma, turn).catch(
      async (err) => {
        await passFailed("Catatonic death", err);
        return null;
      },
    );
    if (catatonicDeath) await markDone("catatonicDeath");
  }
  const {
    deaths: catatonicDeaths = [],
    warnings: catatonicDeathWarnings = [],
    ...catatonicDeathSummary
  } = catatonicDeath ?? {};
  if (catatonicDeath) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "catatonic_deaths_resolved",
          details: catatonicDeathSummary,
        },
      })
      .catch((err) => console.error("Catatonic death audit log failed:", err));
  }

  // The horse eats first (db/lib/horseUpkeepPass.js). Held, not equipped, and
  // a character who cannot afford the 1 ⬢ pays nothing and keeps the animal.
  let horseUpkeep = null;
  if (!done.has("horseUpkeep")) {
    horseUpkeep = await runHorseUpkeepPass(prisma, turn).catch(async (err) => {
      await passFailed("Horse upkeep", err);
      return null;
    });
    if (horseUpkeep) await markDone("horseUpkeep");
  }
  if (horseUpkeep) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "horse_upkeep",
          details: horseUpkeep,
        },
      })
      .catch((err) => console.error("Horse upkeep audit log failed:", err));
  }

  // Hunger upkeep runs after the sweep, so a Hunger granted last close is
  // cleared before this pass can grant a fresh one — otherwise the re-grant
  // collides with @@unique([characterId, tagId]) and gets dropped. See
  // db/lib/hungerPass.js.
  let hunger = null;
  if (!done.has("hunger")) {
    hunger = await runHungerPass(prisma, turn).catch(async (err) => {
      await passFailed("Hunger", err);
      return null;
    });
    if (hunger) await markDone("hunger");
  }

  const {
    hungerNotices = [],
    moodDms: hungerMoodDms = [],
    ...summary
  } = hunger ?? {};
  if (hunger) {
    // Starving into Dying moved the mood dial; the band DM is a tag notice.
    tagExpiryDms.push(...hungerMoodDms);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "hunger_resolved",
          details: summary,
        },
      })
      .catch((err) => console.error("Hunger audit log failed:", err));
  }

  // Dawn afflictions: Guilt Ridden and Insomniac each carry a nightly chance
  // of waking Exhausted. After hunger so it sees the final sheet, same as
  // carry below. See db/lib/dawnAfflictionPass.js.
  let dawnAfflictions = null;
  if (!done.has("dawnAfflictions")) {
    dawnAfflictions = await runDawnAfflictionPass(prisma, turn).catch(async (err) => {
      await passFailed("Dawn afflictions", err);
      return null;
    });
    if (dawnAfflictions) await markDone("dawnAfflictions");
  }
  const { notices: dawnAfflictionNotices = [], ...dawnAfflictionSummary } = dawnAfflictions ?? {};
  if (dawnAfflictions) {
    // Rides the tagExpiry DM channel rather than threading a variable of its
    // own through runSideEffects/advanceTurn — it is the same kind of notice
    // ("a tag on your sheet changed"), same as visionDecay above.
    tagExpiryDms.push(...dawnAfflictionNotices);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "dawn_afflictions_resolved",
          details: dawnAfflictionSummary,
        },
      })
      .catch((err) => console.error("Dawn afflictions audit log failed:", err));
  }

  // Xom's table. See db/lib/xomPass.js for why it sits exactly here.
  let xom = null;
  if (!done.has("xom")) {
    xom = await runXomPass(prisma, turn).catch(async (err) => {
      await passFailed("Xom", err);
      return null;
    });
    if (xom) await markDone("xom");
  }
  const {
    notices: xomNotices = [],
    deaths: xomDeaths = [],
    teleports: xomTeleports = [],
    conversations: xomConversations = [],
    shouts: xomShouts = [],
    ...xomSummary
  } = xom ?? {};
  if (xom) {
    // Same channel the dawn afflictions ride: every one of these is "a tag on
    // your sheet changed", even when something louder happened as well.
    tagExpiryDms.push(...xomNotices);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "xom_resolved",
          details: xomSummary,
        },
      })
      .catch((err) => console.error("Xom audit log failed:", err));
  }

  // Carry caps: Overburdened on and off, and overflow drops for anyone whose
  // Cart or Pack Mule left during the turn. After hunger so it sees the
  // final sheet. See db/lib/carryPass.js, CARRY.md.
  let carry = null;
  if (!done.has("carry")) {
    carry = await runCarryPass(prisma, turn).catch(async (err) => {
      await passFailed("Carry", err);
      return null;
    });
    if (carry) await markDone("carry");
  }
  const { drops: carryDrops = [], ...carrySummary } = carry ?? {};
  if (carry) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "carry_resolved",
          details: carrySummary,
        },
      })
      .catch((err) => console.error("Carry audit log failed:", err));
  }

  // The mood dial's nightly settle (docs/systemdocs/MOOD.md): every ALIVE
  // character pays or earns the night for where they stand, and slides a
  // little back toward Fine. See db/lib/moodPass.js.
  let mood = null;
  if (!done.has("mood")) {
    mood = await runMoodPass(prisma, turn).catch(async (err) => {
      await passFailed("Mood", err);
      return null;
    });
    if (mood) await markDone("mood");
  }
  if (mood) {
    // "You are now Afraid." is a tag notice like any other; same channel.
    const { dms: moodDms = [], ...moodSummary } = mood;
    tagExpiryDms.push(...moodDms);
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "mood_resolved",
          details: moodSummary,
        },
      })
      .catch((err) => console.error("Mood audit log failed:", err));
  }

  // Every dead sheet catches up with wherever its corpse ended up. Last of
  // the inventory-shaped passes, so it sees the carry drop above.
  if (!done.has("corpseFollow")) {
    const followed = await reconcileCorpses(prisma).catch(async (err) => {
      await passFailed("Corpse follow", err);
      return null;
    });
    if (followed) {
      await markDone("corpseFollow");
      if (followed.length > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "corpses_followed",
              details: { moved: followed.length },
            },
          })
          .catch((err) =>
            console.error("Corpse follow audit log failed:", err),
          );
      }
    }
  }

  // Drift every Location's yield coefficients one turn forward
  // (db/lib/laborYield.js). Random and therefore NOT idempotent, which is
  // exactly why it is a named pass: markDone stops a resumed advance from
  // drifting the whole map twice.
  if (!done.has("laborYield")) {
    const yields = await runLaborYieldPass(prisma, turn).catch(async (err) => {
      await passFailed("Labor yield drift", err);
      return null;
    });
    if (yields) {
      await markDone("laborYield");
      if (yields.drifted) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "labor_yields_drifted",
              details: yields,
            },
          })
          .catch((err) => console.error("Labor yield audit log failed:", err));
      }
    }
  }

  // bumpBlood rather than a computed literal off `config`: that snapshot
  // predates the passes above, so a donation made during the advance would
  // otherwise be discarded by the write-back.
  let lifewebBlood = (await readGameState(prisma, { lifewebBlood: true }))?.lifewebBlood ?? 100;
  if (!done.has("lifewebDecay")) {
    try {
      const moved = await bumpBlood(
        prisma,
        -(config?.lifewebDecayPerTurn ?? 10),
      );
      lifewebBlood = moved.after;
      await markDone("lifewebDecay");
    } catch (err) {
      await passFailed("Lifeweb decay", err);
    }
  } else {
    const fresh = await readGameState(prisma, { lifewebBlood: true });
    lifewebBlood = fresh?.lifewebBlood ?? lifewebBlood;
  }

  // What the buildings make. Claims each structure's turn on its own row
  // (Structure.lastUpkeepTurnId), so a resume that re-enters this cannot pour
  // twice — which is why it needs nothing from `done` beyond the usual skip.
  if (!done.has("structureYield")) {
    const yielded = await runStructureYieldPass(prisma, turn).catch(async (err) => {
      await passFailed("Structure yield", err);
      return null;
    });
    if (yielded) {
      await markDone("structureYield");
      if (yielded.poured > 0 || yielded.skipped > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "structures_yielded",
              details: { poured: yielded.poured, skipped: yielded.skipped },
            },
          })
          .catch((err) => console.error("Structure yield audit log failed:", err));
      }
    }
  }

  // What Arelitz lay: an egg into the owner's pocket, or into the room's
  // stash for one parked there. See db/lib/arelitzLayPass.js's header for why
  // this sits right after structureYield and does not share its per-row
  // claim.
  if (!done.has("arelitzLay")) {
    const laid = await runArelitzLayPass(prisma, turn).catch(async (err) => {
      await passFailed("Arelitz lay", err);
      return null;
    });
    if (laid) {
      await markDone("arelitzLay");
      if (laid.laidToCharacters > 0 || laid.laidToRooms > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "arelitz_lay",
              details: laid,
            },
          })
          .catch((err) => console.error("Arelitz lay audit log failed:", err));
      }
    }
  }

  // The Depot's hardware. Returns the ambient lines and DMs it owes rather
  // than speaking them — see TURN-ENGINE.md §3.
  let depot = null;
  if (!done.has("depot")) {
    depot = await runDepotPass(prisma, turn).catch(async (err) => {
      await passFailed("Depot", err);
      return null;
    });
    if (depot) await markDone("depot");
  }
  let gatehouse = null;
  if (!done.has("gatehouseTurret")) {
    gatehouse = await runGatehouseTurretPass(prisma, turn).catch(
      async (err) => {
        await passFailed("Gatehouse turret", err);
        return null;
      },
    );
    if (gatehouse) await markDone("gatehouseTurret");
  }
  if (gatehouse?.turretShots) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "gatehouse_turret_fired",
          details: {
            turretShots: gatehouse.turretShots,
            turretOutcomes: gatehouse.turretOutcomes,
          },
        },
      })
      .catch((err) => console.error("Gatehouse turret audit log failed:", err));
  }

  if (
    depot &&
    (depot.turretShots || depot.generatorDied || depot.shuttleDeparted)
  ) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: "system",
          actionType: "depot_resolved",
          details: {
            fuelBurned: depot.fuelBurned,
            generatorDied: depot.generatorDied,
            shuttleDeparted: depot.shuttleDeparted,
            turretShots: depot.turretShots,
            turretOutcomes: depot.turretOutcomes,
          },
        },
      })
      .catch((err) => console.error("Depot audit log failed:", err));
  }

  // Everyone who set out last turn arrives. Discord work is deliberately not
  // done here — the rows go out with zoneMoves and runSideEffects swaps the
  // roles and rolls the Caving Die, which needs the NEXT turn open anyway.
  let travelArrivals = [];
  if (!done.has("travelArrival")) {
    const arrived = await runTravelArrivalPass(prisma, config).catch(
      async (err) => {
        await passFailed("Travel arrival", err);
        return null;
      },
    );
    if (arrived) {
      await markDone("travelArrival");
      travelArrivals = arrived;
      if (arrived.length > 0) {
        await prisma.auditLog
          .create({
            data: {
              actorDiscordUserId: "system",
              actionType: "travellers_arrived",
              details: {
                arrived: arrived.map((a) => ({ name: a.name, to: a.toLocationName })),
              },
            },
          })
          .catch((err) => console.error("Travel arrival audit log failed:", err));
      }
    }
  }

  // needsResolvedAt is the sole selector for advanceTurn()'s resume query,
  // so it's only stamped once every pass in TURN_PASSES has run.
  const outstanding = TURN_PASSES.filter((name) => !done.has(name));
  if (outstanding.length === 0) {
    await prisma.turn
      .update({ where: { id: turn.id }, data: { needsResolvedAt: new Date() } })
      .catch((err) => console.error("Failed to stamp needsResolvedAt:", err));
  } else {
    console.error(
      `Turn #${turn.number} finished with ${outstanding.length} pass(es) unapplied: ` +
        `${outstanding.join(", ")}. Leaving needsResolvedAt null so the next advance retries them.`,
    );
  }

  await prisma.turn
    .update({ where: { id: turn.id }, data: { needsResumeClaimedAt: null } })
    .catch((err) => console.error("Failed to release the resume lease:", err));

  return {
    lifewebBlood,
    hungerNotices,
    autoLaborDms,
    lessonDms,
    researchDms,
    confessionDms,
    tagExpiryDms,
    catatonicDms,
    catatonicRoleUpdates,
    catatonicDeaths,
    catatonicDeathWarnings,
    dyingDeaths,
    dyingDeathWarnings,
    nukeDeaths,
    nukeBroadcast,
    ascensionDeaths,
    ascensionBroadcast,
    gameEndedPost,
    birdNotices,
    carryDrops,
    privateDeliveries,
    publicPosts,
    zoneMoves,
    travelArrivals,
    xomDeaths,
    xomTeleports,
    xomConversations,
    xomShouts,
    routineNotices,
    gambitRollNotices,
    depotLines: depot?.lines ?? [],
    // Both guns' DMs, delivered by one loop. It was `depotDms` when there was
    // only the one turret.
    turretDms: [...(depot?.dms ?? []), ...(gatehouse?.dms ?? [])],
    // Both guns' kills, for the same teardown every other death gets. Until
    // this was carried up, a turret-killed character kept their personal role,
    // every channel overwrite and their nickname, and never got the ghost seat.
    turretDeaths: [...(depot?.deaths ?? []), ...(gatehouse?.deaths ?? [])],
    depotLocationId: depot?.locationId ?? null,
    // Where each gun fired, if either did. Two entries rather than one, because
    // both can go off in the same turn and each is heard by its own zone.
    turretBursts: [depot?.burstLocationId, gatehouse?.burstLocationId].filter(Boolean),
  };
}

async function getConfig() {
  return prisma.gameConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

// Finish the Discord half of a turn whose fan-out was killed part-way.
//
// This is what did not exist on 2026-09-08, when the bomb went off and a
// redeploy SIGTERM'd the container twenty-eight seconds later: the deaths were
// in the database, the game was over, and the fireball and the Game Ended post
// were simply gone. See db/lib/turnSideEffects.js.
//
// Two callers, and the second is the one that matters. advanceTurn()'s own
// thunk runs it first, so the next advance catches up whatever the last one
// dropped — but a game that ended at 22:00 is not helped by the 04:00 cron.
// The bot calls it on ready() as one of its catch-up passes, because the bot
// coming back up is the fastest signal available that somebody's process just
// died.
async function resumeTurnSideEffects(prisma_, { skipTurnId = null } = {}) {
  const db = prisma_ ?? prisma;
  const unfinished = await db.turn.findFirst({
    where: {
      sideEffectsDoneAt: null,
      // A turn that closed before this ledger existed has no payload, and
      // there is nothing to replay for it.
      sideEffectPayload: { not: Prisma.DbNull },
      ...(skipTurnId ? { id: { not: skipTurnId } } : {}),
    },
    orderBy: { number: "asc" },
    select: { id: true, number: true, sideEffectPayload: true, sideEffectSteps: true },
  });
  if (!unfinished) return { resumed: false };

  // The same compare-and-swap the needs resume does, and for the same reason:
  // sideEffectSteps is last-write-wins and cannot arbitrate two racers.
  const staleBefore = new Date(Date.now() - RESUME_LEASE_MS);
  const claimed = await db.turn.updateMany({
    where: {
      id: unfinished.id,
      sideEffectsDoneAt: null,
      OR: [{ sideEffectClaimedAt: null }, { sideEffectClaimedAt: { lt: staleBefore } }],
    },
    data: { sideEffectClaimedAt: new Date() },
  });
  if (claimed.count === 0) {
    console.warn(
      `Turn #${unfinished.number}'s side effects are already being resumed elsewhere — standing down.`,
    );
    return { resumed: false };
  }

  const outstanding = Array.isArray(unfinished.sideEffectSteps)
    ? unfinished.sideEffectSteps.length
    : 0;
  console.warn(
    `Turn #${unfinished.number} said only part of what it had to say — finishing it (${outstanding} step(s) already sent).`,
  );
  await db.auditLog
    .create({
      data: {
        actorDiscordUserId: "system",
        actionType: "turn_side_effects_resumed",
        details: { turnNumber: unfinished.number, alreadySent: outstanding },
      },
    })
    .catch((err) =>
      console.error(
        "Failed to log turn_side_effects_resumed — the resume now has no record:",
        err,
      ),
    );

  await runTurnSideEffects(db, {
    turnId: unfinished.id,
    payload: unfinished.sideEffectPayload,
  });
  return { resumed: true, turnNumber: unfinished.number };
}

// Resolves the OPEN turn and opens the next, alternating DAWN/DUSK. Shared
// by the bot's cron advance and the GM "End Turn" action. Discord side
// effects are returned as a `runSideEffects()` thunk rather than run here —
// the message wipe can take minutes, so a caller awaits it only where safe
// (the bot's cron inline; the web action via next/server's after()).
//
// Returns { advanced, previousTurn, newTurn, note, runSideEffects }.
// `advanced` is false when another caller won the race to close the open
// turn; callers must check it before using `newTurn`. It is also false, with
// `refused: "NOT_RUNNING"`, outside the RUNNING phase: a game in the lobby or
// already ended has no clock (docs/systemdocs/LOBBY.md §1), and both callers
// — the bot's cron and the Dev Panel's End turn — land here, so this is the
// one gate rather than two.
async function advanceTurn() {
  const config = await getConfig();
  const state = await getGameState(prisma);
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  if (state.phase !== "RUNNING") {
    return {
      advanced: false,
      refused: "NOT_RUNNING",
      previousTurn: null,
      newTurn: openTurn,
      note: null,
      runSideEffects: async () => {},
    };
  }

  let lifewebBlood = state.lifewebBlood;
  let hungerNotices = [];
  let autoLaborDms = [];
  let lessonDms = [];
  let researchDms = [];
  let confessionDms = [];
  let tagExpiryDms = [];
  let depotLines = [];
  let turretDms = [];
  let turretDeaths = [];
  let depotLocationId = null;
  let turretBursts = [];
  let catatonicDms = [];
  let catatonicRoleUpdates = [];
  let catatonicDeaths = [];
  let catatonicDeathWarnings = [];
  let dyingDeaths = [];
  let nukeDeaths = [];
  let nukeBroadcast = null;
  let ascensionDeaths = [];
  let ascensionBroadcast = null;
  let gameEndedPost = null;
  let dyingDeathWarnings = [];
  let birdNotices = [];
  let carryDrops = [];
  let privateDeliveries = [];
  let publicPosts = [];
  let zoneMoves = [];
  let travelArrivals = [];
  let xomDeaths = [];
  let xomTeleports = [];
  let xomConversations = [];
  let xomShouts = [];
  let routineNotices = [];
  let gambitRollNotices = [];
  // Which row carries this fan-out's payload: always the turn that just
  // closed, never the one about to open. In the resume branch below that is
  // the crashed turn, not `newTurn` — attaching it to the new OPEN turn would
  // let its own close, a day later, overwrite an unfinished ledger.
  let closedTurnId = openTurn?.id ?? null;
  if (openTurn) {
    // Close the turn first, conditioned on it still being OPEN — Postgres
    // serializes the updateMany, so exactly one racing caller sees count===1
    // and the loser bails rather than double-resolving Needs.
    const closed = await prisma.turn.updateMany({
      where: { id: openTurn.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    if (closed.count === 0) {
      const winner = await prisma.turn.findFirst({ where: { status: "OPEN" } });
      return {
        advanced: false,
        previousTurn: null,
        newTurn: winner,
        note: null,
        runSideEffects: async () => {},
      };
    }

    ({
      lifewebBlood,
      hungerNotices,
      autoLaborDms,
      lessonDms,
      researchDms,
      confessionDms,
      tagExpiryDms,
      catatonicDms,
      catatonicRoleUpdates,
      catatonicDeaths,
      catatonicDeathWarnings,
      dyingDeaths,
      dyingDeathWarnings,
      nukeDeaths,
      nukeBroadcast,
      ascensionDeaths,
      ascensionBroadcast,
      gameEndedPost,
      birdNotices,
      carryDrops,
      privateDeliveries,
      publicPosts,
      zoneMoves,
      travelArrivals,
      xomDeaths,
      xomTeleports,
      xomConversations,
      xomShouts,
      routineNotices,
      gambitRollNotices,
      depotLines,
      turretDms,
      turretDeaths,
      depotLocationId,
      turretBursts,
    } = await resolveNeeds(openTurn, config));
  } else {
    // No OPEN turn: either this is the first turn ever, or a previous advance
    // claimed the turn and died before creating the next one. A RESOLVED
    // turn with no needsResolvedAt is that crash; finish only its remaining
    // passes.
    const unfinished = await prisma.turn.findFirst({
      where: { status: "RESOLVED", needsResolvedAt: null },
      orderBy: { number: "desc" },
    });
    if (unfinished) {
      // Same compare-and-swap as the normal path, on needsResumeClaimedAt
      // (resolvedPasses is last-write-wins, not a lock). Stale claims are
      // recoverable via RESUME_LEASE_MS.
      const staleBefore = new Date(Date.now() - RESUME_LEASE_MS);
      const claimed = await prisma.turn.updateMany({
        where: {
          id: unfinished.id,
          needsResolvedAt: null,
          OR: [
            { needsResumeClaimedAt: null },
            { needsResumeClaimedAt: { lt: staleBefore } },
          ],
        },
        data: { needsResumeClaimedAt: new Date() },
      });

      if (claimed.count === 0) {
        console.warn(
          `Turn #${unfinished.number} is already being resumed by another advance — standing down.`,
        );
        return {
          advanced: false,
          previousTurn: null,
          newTurn: null,
          note: null,
          runSideEffects: async () => {},
        };
      }

      console.warn(
        `Turn #${unfinished.number} was claimed but never finished resolving — resuming its outstanding passes.`,
      );
      closedTurnId = unfinished.id;
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: "system",
            actionType: "turn_resume",
            details: {
              turnNumber: unfinished.number,
              alreadyApplied: unfinished.resolvedPasses ?? [],
            },
          },
        })
        .catch((logErr) =>
          console.error(
            "Failed to log turn_resume — the resume now has no record:",
            logErr,
          ),
        );
      ({
        lifewebBlood,
        hungerNotices,
        autoLaborDms,
        lessonDms,
        confessionDms,
        tagExpiryDms,
        catatonicDms,
        catatonicRoleUpdates,
        catatonicDeaths,
        catatonicDeathWarnings,
        dyingDeaths,
        dyingDeathWarnings,
        nukeDeaths,
        nukeBroadcast,
        ascensionDeaths,
        ascensionBroadcast,
        gameEndedPost,
        birdNotices,
        carryDrops,
        privateDeliveries,
        publicPosts,
        zoneMoves,
        travelArrivals,
        xomDeaths,
        xomTeleports,
        xomConversations,
        xomShouts,
        routineNotices,
        gambitRollNotices,
        depotLines,
        turretDms,
        depotLocationId,
      } = await resolveNeeds(unfinished, config));
    }
  }

  const lastTurn =
    openTurn ?? (await prisma.turn.findFirst({ orderBy: { number: "desc" } }));
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";
  // Picked once, here, and remembered on the Turn row — a repost of the
  // announcement must show the same picture, not roll a new one.
  const banner = await nextTurnBanner(prisma, phase);
  const lifewebFlavor =
    lifewebBlood <= LIFEWEB_SPUTTER_THRESHOLD
      ? "The Lifeweb sputters, failing."
      : null;
  const note =
    [lifewebFlavor, state.nextTurnNote].filter(Boolean).join("\n\n") || null;

  const newTurn = await prisma.turn.create({
    data: {
      number: (lastTurn?.number ?? 0) + 1,
      phase,
      banner,
      gameDate: new Date(),
      status: "OPEN",
    },
  });

  await prisma.gameState.update({
    where: { id: 1 },
    data: { nextTurnNote: null },
  });

  // One row per zone rather than one for the game, so every zone's feed on
  // /chat carries the day line (HALL.md §5). /archive folds them back into the
  // single sticky day divider it always drew — a TURN_START row is never
  // rendered as a row, and the divider keys on the day.
  const turnStartContent = [
    `Day ${Math.ceil(newTurn.number / 2)} — ${newTurn.phase}`,
    note,
  ]
    .filter(Boolean)
    .join("\n");
  const turnStartZones = await prisma.zone
    .findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } })
    .catch(() => []);
  for (const zone of turnStartZones) {
    await recordArchiveEvent(prisma, {
      kind: "TURN_START",
      turn: newTurn,
      content: turnStartContent,
      zoneId: zone.id,
      zoneName: zone.name,
      placeKey: `zone:${zone.id}`,
    });
  }
  if (turnStartZones.length === 0) {
    await recordArchiveEvent(prisma, {
      kind: "TURN_START",
      turn: newTurn,
      content: turnStartContent,
    });
  }

  // Everything below this line is the only place in the turn-advance path
  // that talks to Discord; every resolveNeeds() pass hands back posts/DMs
  // instead of sending them.
  // Everything the thunk will need, written to the row BEFORE it runs, so a
  // process that never saw this turn resolve can still finish the fan-out.
  // See db/lib/turnSideEffects.js for the whole story; the short version is
  // that a redeploy landing mid-fan-out used to lose the rest of it forever.
  const sideEffectPayload = buildSideEffectPayload({
    newTurnId: newTurn.id,
    note,
    autoLaborDms,
    lessonDms,
    researchDms,
    confessionDms,
    tagExpiryDms,
    turretBursts,
    depotLocationId,
    depotLines,
    turretDms,
    birdNotices,
    carryDrops,
    catatonicDms,
    catatonicRoleUpdates,
    catatonicDeathWarnings,
    dyingDeathWarnings,
    catatonicDeaths,
    dyingDeaths,
    nukeDeaths,
    ascensionDeaths,
    turretDeaths,
    hungerNotices,
    zoneMoves,
    travelArrivals,
    xomDeaths,
    xomTeleports,
    xomConversations,
    xomShouts,
    privateDeliveries,
    routineNotices,
    gambitRollNotices,
    nukeBroadcast,
    ascensionBroadcast,
    gameEndedPost,
    publicPosts,
  });
  const sideEffectTurnId = closedTurnId ?? newTurn.id;
  await prisma.turn
    .update({
      where: { id: sideEffectTurnId },
      data: { sideEffectPayload, sideEffectSteps: [], sideEffectsDoneAt: null },
    })
    .catch((err) => console.error("Failed to persist the side-effect payload:", err));

  const runSideEffects = async () => {
    // An earlier turn whose fan-out was killed goes first — it is older news,
    // and if the bomb went off yesterday nobody should read this turn's banner
    // before the fireball.
    await resumeTurnSideEffects(prisma, { skipTurnId: sideEffectTurnId }).catch((err) =>
      console.error("Resuming an earlier turn's side effects failed:", err),
    );
    await runTurnSideEffects(prisma, {
      turnId: sideEffectTurnId,
      payload: sideEffectPayload,
    });
  };

  return {
    advanced: true,
    previousTurn: openTurn,
    newTurn,
    note,
    runSideEffects,
  };
}

module.exports = {
  prisma,
  // Prisma.DbNull is required in a WHERE filter to test a nullable Json
  // column for SQL NULL — a bare `null` there is read as "skip this
  // condition", not "is null" (db/lib/moves.js, db/lib/stagedPush.js). A
  // stale claim used to sit here saying a DATA write needs it too; it
  // doesn't — `data: { poisonPayload: null }` (db/lib/tagWrites.js, M4)
  // writes a plain JS null into a nullable Json column just fine. DbNull is
  // a filter-side sentinel, not a write-side one.
  Prisma,
  resolveNeeds,
  advanceTurn,
  resumeTurnSideEffects,
  runFullChannelWipe,
  syncZonesFromYaml,
  syncTagsFromYaml,
  deleteCharacterRow,
  syncRolesFromYaml,
  syncDesiresFromYaml,
  syncDocumentsFromYaml,
  syncLaborDropsFromYaml,
  SPECIAL_CHANNELS,
  NARROWCAST_SLUGS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
  syncSpecialChannels,
  ...require("./lib/placeKey"),
  // archive.js is deliberately NOT spread whole (it takes prisma by
  // parameter and its writers are meant to be required by path); these two
  // are pure shape helpers with no prisma in them, and both faces render the
  // wire row.
  feedRowShape: require("./lib/archive").feedRowShape,
  FEED_ROW_SELECT: require("./lib/archive").FEED_ROW_SELECT,
  ...require("./lib/seatZone"),
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./turnCalendar"),
  ...require("./lib/constants"),
  ...require("./lib/roleIds"),
  ...require("./lib/gmZoneView"),
  ...require("./lib/roleColor"),
  ...require("./lib/characterRoleAppearance"),
  ...require("./lib/characterName"),
  ...require("./lib/titles"),
  ...require("./lib/nameCorpus"),
  ...require("./lib/dynasty"),
  ...require("./lib/concealedIdentity"),
  ...require("./lib/presentedIdentity"),
  ...require("./lib/threats"),
  ...require("./lib/roleCapacity"),
  ...require("./lib/gameState"),
  ...require("./lib/gameConfigFields"),
  ...require("./lib/production"),
  ...require("./lib/depot"),
  ...require("./lib/depotState"),
  ...require("./lib/depotTurret"),
  ...require("./lib/turretBurst"),
  ...require("./lib/depotCrates"),
  ...require("./lib/startingTags"),
  ...require("./lib/locationAttributes"),
  ...require("./lib/formatTagRequirement"),
  ...require("./lib/armorValue"),
  ...require("./lib/formatTagArmor"),
  ...require("./lib/turnFormat"),
  ...require("./lib/turnClock"),
  ...require("./lib/lifeweb"),
  ...require("./lib/gambitModifier"),
  ...require("./lib/moveEffects"),
  ...require("./lib/resourceDelta"),
  ...require("./lib/laborAccess"),
  ...require("./lib/laborYield"),
  // Only the pure helper — the revoke functions take prisma as a parameter
  // and are kept off the barrel; require db/lib/accessSweep.js by path.
  zoneChannelIds: require("./lib/accessSweep").zoneChannelIds,
};
