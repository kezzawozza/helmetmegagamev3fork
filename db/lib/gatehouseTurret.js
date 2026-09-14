// The Gatehouse turret: the machinegun in the fortress yard. Opposite of the
// Depot turret in the one way that matters: the Merchant's gun reads faces
// and spares one, this one spares nobody, no list/keycard/rank — arm it and
// it fires on whoever's in the yard, Censor included, which is why the switch
// is a physical button in the Censor's Office and not a page anyone can
// reach. Rolls on the shipped table (db/lib/depotTurret.js#DEFAULT_TURRET_TABLE);
// armour still bends the curve. Takes `prisma` as a parameter (db/lib/dm.js).
const { sweepTurretAt, applyTurretShot, rollTurretOnArrivalAt, turretDmFor } = require("./turretPass");

const GATEHOUSE_LOCATION_SLUG = "gatehouse";

const DEATH_CONTENT = "Shot by a turret.";

// Same split as the Depot's: DEATH_CONTENT is what the archive records, this is what the dead are told.
const DEATH_REASON = "they were shot by a turret.";

const GATEHOUSE_TURRET_DM = {
  graze: "The turret shoots you. You get in cover just in time.",
  hit: "The turret shoots you.",
  dead: "The turret shoots you.",
};

// Scenery, not an announcement — `-#` subtext (db/lib/ambientLine.js), the only warning the yard gets.
const TURRET_ARMED_LINE = {
  text: "You hear something in the yard whir.",
  signed: false,
};

const TURRET_DISARMED_LINE = {
  text: "You hear the rotor in the yard settle.",
  signed: false,
};

async function gatehouseTurretArmed(prisma) {
  const state = await prisma.gameState.findUnique({
    where: { id: 1 },
    select: { gatehouseTurretArmed: true },
  });
  return state?.gatehouseTurretArmed === true;
}

// Returns DMs for the caller to send, the way every other pass does (TURN-ENGINE.md §3).
async function runGatehouseTurretPass(prisma, turn) {
  if (!(await gatehouseTurretArmed(prisma))) {
    return { turretShots: 0, turretOutcomes: [], dms: [], deaths: [], burstLocationId: null };
  }

  const { shots, locationId } = await sweepTurretAt(prisma, { locationSlug: GATEHOUSE_LOCATION_SLUG });

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
      dms.push({ discordUserId: outcome.discordUserId, content: turretDmFor(GATEHOUSE_TURRET_DM, outcome) });
    }
    if (outcome.death) deaths.push(outcome.death); // Discord teardown carried up to the side-effect thunk
  }

  // One burst for the whole sweep, not one per victim (turretBurst.js). Null when it rolled at
  // nobody — an empty yard makes no noise.
  return {
    turretShots: outcomes.length,
    turretOutcomes: outcomes,
    dms,
    deaths,
    burstLocationId: outcomes.length ? locationId : null,
  };
}

// `armed` is a thunk so the GameConfig read never happens for arrivals that aren't the Gatehouse.
function rollGatehouseTurretOnArrival(prisma, { characterId, toLocationId, turn }) {
  return rollTurretOnArrivalAt(prisma, {
    characterId,
    toLocationId,
    turn,
    locationSlug: GATEHOUSE_LOCATION_SLUG,
    armed: async () => ({ armed: await gatehouseTurretArmed(prisma) }),
    deathContent: DEATH_CONTENT,
    deathReason: DEATH_REASON,
  });
}

// Deliberate friction against a misclick shooting the Keep; lives here (not the bot's modal
// builder) so Chat's confirm asks for the same word. Case/stray spaces forgiven.
const ARM_WORD = "ARM";
const DISARM_WORD = "DISARM";

// `armed` is the turret's state RIGHT NOW, so the confirm asks for the opposite.
function turretWordMatches(typed, armed) {
  return String(typed ?? "").trim().toUpperCase() === (armed ? DISARM_WORD : ARM_WORD);
}

module.exports = {
  ARM_WORD,
  DISARM_WORD,
  turretWordMatches,
  GATEHOUSE_LOCATION_SLUG,
  GATEHOUSE_TURRET_DM,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
  gatehouseTurretArmed,
  runGatehouseTurretPass,
  rollGatehouseTurretOnArrival,
};
