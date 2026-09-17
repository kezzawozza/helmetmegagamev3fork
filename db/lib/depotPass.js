// The Depot's per-turn upkeep, which is now one thing: the turret sweeps the
// room. Run from db/index.js#resolveNeeds() so the bot's cron advance and the
// Dev Panel's "End turn" behave identically. Like every other pass it mutates
// the database and RETURNS its side effects rather than making a network call
// itself (TURN-ENGINE.md §3). Takes `prisma` as a parameter (db/lib/dm.js).
//
// It used to burn generator fuel and run the shuttle's clock as well. The
// generator is gone — it was a switch one person could flip to take the whole
// market down for a day — and the shuttle is a train on a fixed cycle now
// (db/lib/trainArrivalPass.js, db/lib/trainDeparturePass.js). The gun stays,
// and with no generator to depend on, ARMED is now the only condition.
const { loadDepot } = require("./depotState");
const { turretSpares } = require("./depotTurret");
const { DEPOT_LOCATION_SLUG } = require("./depot");
// The sweep, arrival roll and bullet logic are shared with the Gatehouse
// turret (gatehouseTurret.js). What's left here makes THIS gun the
// Merchant's: it reads faces against Depot.merchantFace.
const { sweepTurretAt, applyTurretShot, rollTurretOnArrivalAt, turretDmFor } = require("./turretPass");

const TURRET_DM = {
  graze: "The turret shoots you. You get in cover just in time.",
  hit: "The turret shoots you.",
  dead: "The turret shoots you.",
};

// Armed, or it does nothing.
async function sweepTurret(prisma, depot) {
  if (!depot.turretArmed) return { shots: [] };

  return sweepTurretAt(prisma, {
    locationSlug: DEPOT_LOCATION_SLUG,
    tableSource: depot,
    spares: (name) => turretSpares(name, depot),
  });
}

const DEATH_CONTENT = "Shot by a turret.";
// What the death DM ends on and #leave reads — the plain fact, must survive being read out of context.
const DEATH_REASON = "they were shot by a turret.";

// `armed` is a thunk so loadDepot (an upsert, a write on one contended row) never runs for
// arrivals that aren't the Depot.
function rollTurretOnArrival(prisma, { characterId, toLocationId, turn }) {
  return rollTurretOnArrivalAt(prisma, {
    characterId,
    toLocationId,
    turn,
    locationSlug: DEPOT_LOCATION_SLUG,
    armed: async () => {
      const depot = await loadDepot(prisma);
      return {
        armed: Boolean(depot.turretArmed),
        tableSource: depot,
        depot,
      };
    },
    spares: (name, state) => turretSpares(name, state.depot),
    deathContent: DEATH_CONTENT,
    deathReason: DEATH_REASON,
  });
}

async function runDepotPass(prisma, turn) {
  const depot = await loadDepot(prisma);
  const { shots } = await sweepTurret(prisma, depot);

  const location = await prisma.location
    .findUnique({ where: { slug: DEPOT_LOCATION_SLUG }, select: { id: true } })
    .catch(() => null);
  const locationId = location?.id ?? null;

  const dms = [];
  const outcomes = [];
  const deaths = [];
  for (const shot of shots) {
    const outcome = await applyTurretShot(prisma, shot, turn, {
      deathContent: DEATH_CONTENT,
      deathReason: DEATH_REASON,
    });
    outcomes.push({ ...outcome, severity: shot.severity, protection: shot.protection });
    if (outcome.discordUserId) {
      dms.push({ discordUserId: outcome.discordUserId, content: turretDmFor(TURRET_DM, outcome) });
    }
    // Discord teardown carried up to the side-effect thunk — REST calls don't belong inside turn work.
    if (outcome.death) deaths.push(outcome.death);
  }

  return {
    turretShots: outcomes.length,
    turretOutcomes: outcomes,
    locationId,
    // Distinct from `locationId` (set whenever the Depot exists): a gun does not
    // fire in an empty room (turretBurst.js).
    burstLocationId: outcomes.length ? locationId : null,
    lines: [],
    dms,
    deaths,
  };
}

module.exports = {
  runDepotPass,
  rollTurretOnArrival,
  TURRET_DM,
};
