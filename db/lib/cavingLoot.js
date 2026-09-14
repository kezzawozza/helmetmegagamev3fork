// The Caving Die's loot table — code, not YAML, since this is mechanics (a weighted draw) rather than
// player-facing catalog data. See docs/systemdocs/CAVING.md for the full table and weight reasoning.
// db/lib/cavingPass.js is the only caller. Two-stage draw on a roll of 6: pick a tier by the standing
// zone's column below, then pick uniformly among that tier's slugs. Slugs are validated against the
// live Tag catalog by validateCavingLoot() — call once at startup (bot/src/index.js, web's
// instrumentation hook), not per-roll, so a typo fails the deploy rather than a player's roll.

const TIERS = ["ultracommon", "common", "uncommon", "rare", "extremely-rare", "nearly-impossible"];

// Each column sums to 1 (checked by validateCavingLoot). Depths carries the old Aberrant Pits column
// unchanged, since it's the only deep place left on the map.
const WEIGHTS_BY_ZONE = {
  caves: {
    ultracommon: 0.65,
    common: 0.25,
    uncommon: 0.08,
    rare: 0.0195,
    "extremely-rare": 0,
    "nearly-impossible": 0.0005,
  },
  depths: {
    ultracommon: 0.15,
    common: 0.22,
    uncommon: 0.28,
    rare: 0.25,
    "extremely-rare": 0.07,
    "nearly-impossible": 0.03,
  },
};

// Tier contents, by slug. Weapon/armor tiers pull representative slugs off SMITHING.md §3/§4's ladder
// rather than every entry in it.
const LOOT_TABLE = {
  // rock-salt is ultracommon on Bascinet's call (docs/systemdocs/COOKING.md) — the thing a cook can
  // always get and is never pleased to see.
  ultracommon: ["cave-fungus", "saltpeter", "purring-maggot", "rock", "rock-salt"],
  common: ["cudgel", "purse", "cracked-bone-club", "sling", "skinned-cave-rat", "old-coin", "coal"],
  uncommon: [
    "alcohol",
    "cleaning-powder",
    "fine-meal",
    "bear-trap",
    "hatchet",
    "dagger",
    "padded-armor",
    "mail-coif",
    "prospectors-notes",
    "buckler",
    "spear",
    "rope",
    "work-knife",
    "knuckle-duster",
    "honey",
  ],
  rare: [
    "ravenheart-red",
    "cat",
    "salvage-plate",
    "supply-kit",
    "jewelry",
    "bliss",
    "spyglass",
    "gas-mask",
    "broadsword",
    "war-hammer",
    "convoy-directions",
    "instrument",
    "mining-helmet",
  ],
  "extremely-rare": [
    "emp-grenade",
    "smithing-gunpowder",
    "skeleton-wedge",
    "jester-outfit",
    "starting-wares",
    "military-autoinjector",
    "autocannon-shell",
    "zweihander",
    "crossbow",
    "ancient-keycard",
    "fragmentation-grenade",
    "neoclassic-duelista",
  ],
  "nearly-impossible": ["energy-shield", "power-fist", "neoclassic-rw10", "stepstone", "dark-eye-lenses", "motorcycle"],
};

// Validated once at process startup (bot/src/index.js, web's instrumentation.js), not per roll —
// throwing here means the loot table references something absent from docs/tags.yaml.
async function validateCavingLoot(prisma) {
  const allSlugs = new Set(Object.values(LOOT_TABLE).flat());
  const found = await prisma.tag.findMany({ where: { slug: { in: [...allSlugs] } }, select: { slug: true } });
  const foundSlugs = new Set(found.map((t) => t.slug));
  const missing = [...allSlugs].filter((s) => !foundSlugs.has(s));
  if (missing.length) {
    throw new Error(`db/lib/cavingLoot.js: LOOT_TABLE references unknown tag slug(s): ${missing.join(", ")}`);
  }
  for (const [zoneSlug, weights] of Object.entries(WEIGHTS_BY_ZONE)) {
    const sum = TIERS.reduce((total, tier) => total + (weights[tier] ?? 0), 0);
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(`db/lib/cavingLoot.js: WEIGHTS_BY_ZONE["${zoneSlug}"] sums to ${sum}, not 1`);
    }
  }
}

// Draws a tier for the given cave-level zone slug (caves/depths), then a slug uniformly within it.
function drawLoot(zoneSlug) {
  const weights = WEIGHTS_BY_ZONE[zoneSlug];
  if (!weights) throw new Error(`db/lib/cavingLoot.js: no loot weights for zone "${zoneSlug}"`);
  let roll = Math.random();
  let tier = TIERS[TIERS.length - 1];
  for (const t of TIERS) {
    const w = weights[t] ?? 0;
    if (roll < w) {
      tier = t;
      break;
    }
    roll -= w;
  }
  const pool = LOOT_TABLE[tier];
  const slug = pool[Math.floor(Math.random() * pool.length)];
  return { tier, slug };
}

module.exports = { LOOT_TABLE, validateCavingLoot, drawLoot };
