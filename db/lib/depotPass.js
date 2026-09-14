// The Depot's per-turn upkeep: generator burns, shuttle's clock runs out,
// turret sweeps the room. Run from db/index.js#resolveNeeds() so the bot's
// cron advance and Dev Panel's "End turn" behave identically. Like every
// other pass it mutates the database and RETURNS its side effects rather
// than making a network call itself (TURN-ENGINE.md §3). Takes `prisma` as a
// parameter (db/lib/dm.js).
const { loadDepot, bumpFuel, depotPowered, LANDING_PAD_SLUG } = require("./depotState");
const { turretSpares } = require("./depotTurret");
const { DEPOT_LOCATION_SLUG } = require("./depot");
// The sweep, arrival roll and bullet logic are shared with the Gatehouse
// turret (gatehouseTurret.js). What's left here makes THIS gun the
// Merchant's: needs the generator running, reads faces against Depot.merchantFace.
const { sweepTurretAt, applyTurretShot, rollTurretOnArrivalAt, turretDmFor } = require("./turretPass");

// Bascinet's register: a thing that happens TO the room, not an announcement about it.
const GENERATOR_DIED_LINE = {
  text: "You hear the generator cough twice and stop. Every light in the depot goes out at once.",
  signed: true,
};

const SHUTTLE_LANDED_LINE = {
  text: "You hear a shuttle land, hissing steam on the landing pad.",
  signed: false,
};

const SHUTTLE_DEPARTED_LINE = {
  text: "You hear the shuttle depart in a burst of fire.",
  signed: false,
};

const TURRET_DM = {
  graze: "The turret shoots you. You get in cover just in time.",
  hit: "The turret shoots you.",
  dead: "The turret shoots you.",
};

// One turn of the generator. Returns the line to speak if it died this turn.
async function burnGenerator(prisma, depot) {
  if (!depotPowered(depot)) return { burned: 0, died: false };

  const moved = await bumpFuel(prisma, -(depot.fuelBurnPerTurn ?? 0));
  const died = moved.after <= 0;
  if (died) {
    // Flipping the switch too means the Merchant must deliberately restart it after refuelling.
    await prisma.depot.update({ where: { id: 1 }, data: { generatorOn: false } });
  }
  return { burned: -moved.delta, died };
}

// Leaves on its own after shuttleMaxTurns whether or not loaded — stops the
// landing pad becoming a second stash. Does NOT sweep the hold: selling is a
// deliberate act, and crates from a timed-out departure stay on the pad.
async function runShuttleClock(prisma, depot, turn) {
  if (depot.shuttleState !== "DOCKED") return { departed: false };
  const landed = depot.shuttleTurn ?? 0;
  if (turn.number - landed < (depot.shuttleMaxTurns ?? 6)) return { departed: false };

  await prisma.depot.update({
    where: { id: 1 },
    data: { shuttleState: "AWAY", shuttleTurn: turn.number },
  });
  return { departed: true };
}

// Powered and armed, or it does nothing — an unpowered turret is a lump of metal in the ceiling.
async function sweepTurret(prisma, depot) {
  if (!depotPowered(depot) || !depot.turretArmed) return { shots: [] };

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
        armed: depotPowered(depot) && Boolean(depot.turretArmed),
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

  const generator = await burnGenerator(prisma, depot);
  // Re-read: the turret must not fire on power the generator no longer has.
  const afterBurn = await loadDepot(prisma);

  const shuttle = await runShuttleClock(prisma, afterBurn, turn);
  const { shots } = await sweepTurret(prisma, afterBurn);

  // Loaded here, not from sweepTurret's return: an unpowered Depot produces no locationId there,
  // but a just-died generator still needs its line spoken.
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

  // Ambient lines the caller speaks into the Depot's channel.
  const lines = [];
  if (generator.died) lines.push(GENERATOR_DIED_LINE);
  if (shuttle.departed) lines.push(SHUTTLE_DEPARTED_LINE);

  return {
    fuelBurned: generator.burned,
    generatorDied: generator.died,
    shuttleDeparted: shuttle.departed,
    turretShots: outcomes.length,
    turretOutcomes: outcomes,
    locationId,
    // Distinct from `locationId` (set whenever the Depot exists): the generator/shuttle speak in
    // an empty room but a gun does not (turretBurst.js).
    burstLocationId: outcomes.length ? locationId : null,
    lines,
    dms,
    deaths,
  };
}

module.exports = {
  runDepotPass,
  rollTurretOnArrival,
  TURRET_DM,
  // Shuttle lines are spoken from the web actions too (cross a boundary); the generator line does not.
  SHUTTLE_LANDED_LINE,
  SHUTTLE_DEPARTED_LINE,
};
