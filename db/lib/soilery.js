// The Farms placeholder (db/lib/locationAttributes.js's `soilery` attribute):
// sow a plan of crops, then reap what didn't wither. Deliberately small —
// the whole Farms Location is expected to be redesigned later, and this is
// only a stand-in until then. Pure and Prisma-free, modelled on
// db/lib/godflesh.js. See docs/systemdocs/SOILERY.md.

const { SOILERY_SLUG, EXHAUSTED_SLUG, TIRED_SLUG } = require("./constants");

const FARM_MAX_CROPS = 50;
// 1-in-6 fails, independently PER UNIT sown — not a rounded average. See reap() below for why.
const WITHER_IN = 6;

const CROPS = [
  { sowing: "sowing-wheat", crop: "wheat" },
  { sowing: "sowing-potato", crop: "potato" },
  { sowing: "sowing-tomato", crop: "tomato" },
  { sowing: "sowing-carrot", crop: "carrot" },
  { sowing: "sowing-onion", crop: "onion" },
  { sowing: "sowing-plump-helmet", crop: "plump-helmet" },
  { sowing: "sowing-pigtails", crop: "pigtails" },
];

// Accepts the CharacterTag[] shape used everywhere else in the app
// (`{ tag: { slug } }`), and tolerates a bare Tag[] — same contract as
// db/lib/gambitModifier.js#holds.
function holds(characterTags, slug) {
  return (characterTags ?? []).some((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
}

// Which crops this character currently holds the sowing ticket for.
function sowableCrops(characterTags = []) {
  return CROPS.filter((entry) => holds(characterTags, entry.sowing));
}

// `plan` is what a player submits: [{ crop, planted }, ...]. Never throws —
// always answers { ok: false, error } or { ok: true }, since this is meant
// to gate a form submission, not crash a request handler.
function validatePlan(plan, licensed, maxCrops = FARM_MAX_CROPS) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return { ok: false, error: "Nothing to sow." };
  }

  const licensedCrops = new Set((licensed ?? []).map((entry) => entry.crop));
  let total = 0;

  for (const row of plan) {
    const crop = row?.crop;
    const planted = row?.planted;

    if (!licensedCrops.has(crop)) {
      return { ok: false, error: `You don't hold a sowing ticket for "${crop}".` };
    }
    if (!Number.isInteger(planted) || planted <= 0) {
      return { ok: false, error: `"${crop}" must be a positive number of plants.` };
    }
    total += planted;
  }

  if (total === 0) {
    return { ok: false, error: "Nothing to sow." };
  }
  if (total > maxCrops) {
    return { ok: false, error: `A farm holds at most ${maxCrops} crops at once.` };
  }

  return { ok: true };
}

// Rolls `planted` INDEPENDENT 1-in-WITHER_IN chances rather than
// Math.round(planted * (WITHER_IN - 1) / WITHER_IN) — the plan calls for
// real per-unit variance (a small planting can wholly fail or wholly
// survive), which a rounded average can never produce and which later tests
// are expected to check for.
function reap(planted, rng = Math.random) {
  let survived = 0;
  for (let i = 0; i < planted; i++) {
    if (Math.floor(rng() * WITHER_IN) !== 0) survived++;
  }
  return survived;
}

// "sowed 30 Wheat and reaped 25, sowed 20 Potato and reaped 18"
function harvestLine(rows) {
  return (rows ?? [])
    .map((row) => `sowed ${row.planted} ${row.cropName} and reaped ${row.reaped}`)
    .join(", ");
}

// The turn-close DM text for a farm's harvest — harvestLine does the counting, this says it in scene.
function farmDm(turn, rows) {
  const line = harvestLine(rows);
  return `*The Farms brought in their harvest, turn ${turn}.*\n**Harvest:** ${line}`;
}

// Null means "go ahead"; a string is the refusal to show the player.
// Checked in order: must hold Soilery, must NOT be worn
// out (checks BOTH Exhausted and Tired — the two-stage fatigue ladder in
// db/lib/fatigue.js, so either rung locks the farm out, not just the
// deeper one), and must not already have an action open this turn.
function farmRefusalFor(characterTags, hasOpenAction) {
  if (!holds(characterTags, SOILERY_SLUG)) {
    return "You don't know how to farm.";
  }
  if (holds(characterTags, EXHAUSTED_SLUG) || holds(characterTags, TIRED_SLUG)) {
    return "You're too worn out to farm right now.";
  }
  if (hasOpenAction) {
    return "You already have an action this turn.";
  }
  return null;
}

module.exports = {
  FARM_MAX_CROPS,
  WITHER_IN,
  CROPS,
  sowableCrops,
  validatePlan,
  reap,
  harvestLine,
  farmDm,
  farmRefusalFor,
};
