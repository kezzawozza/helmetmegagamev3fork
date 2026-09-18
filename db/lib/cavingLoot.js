// TWO loot tables, both code rather than YAML, since this is mechanics (a weighted draw) rather than
// player-facing catalog data. Both work the same way: pick a tier by the standing zone's column, then
// pick uniformly among that tier's slugs. Slugs are validated against the live Tag catalog by
// validateCavingLoot() — call once at startup (bot/src/index.js, web's instrumentation hook), not
// per-roll, so a typo fails the deploy rather than a player's roll.
//
//   THE CAVING DIE (docs/systemdocs/CAVING.md) — drawn by db/lib/cavingPass.js on a roll of 6 at a
//   CAVE_LEVEL arrival. Junk, tools and the odd weapon: what the caves leave lying around.
//
//   THE PROSPECTING TABLE (docs/systemdocs/MINING.md) — drawn by db/lib/moveEffects.js on every Mine
//   press by a character holding Prospecting. Ore, metal and gemstones only, all of it feeding
//   Smithing and Trinkets.
//
// The two share this file on purpose. They were one weighted draw and one whole YAML-driven
// subsystem (MiningDropOption, a sync, a rarity module, an EV module, an audit script) until
// 2026-09-18, when the second was deleted and folded into the first. Keep them here together: a
// second copy of drawLoot is how they drift apart.
//
// A zone with no column in a weights map simply does not roll on that table. That is what makes the
// Black Hills minable for ⬢ but never for loot — the absence IS the rule, not an oversight.

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
  common: ["cudgel", "purse", "cracked-bone-club", "sling", "skinned-cave-rat", "old-coin"],
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

// The prospecting table's own columns. Thinner than the Caving Die's at the top and steeper at the
// bottom: a day's dig should mostly turn up rock, and the Depths should be where anything worth
// having comes from. There is deliberately no `hills` column (see the header).
const PROSPECTING_WEIGHTS_BY_ZONE = {
  caves: {
    ultracommon: 0.62,
    common: 0.26,
    uncommon: 0.09,
    rare: 0.028,
    "extremely-rare": 0.0015,
    "nearly-impossible": 0.0005,
  },
  depths: {
    ultracommon: 0.18,
    common: 0.24,
    uncommon: 0.28,
    rare: 0.22,
    "extremely-rare": 0.06,
    "nearly-impossible": 0.02,
  },
};

// Ore, metal and stones, plus four things that are not ingredients at all (purse, supply-kit,
// mining-helmet, jewelry, lockbox) sitting at the rare and extremely-rare rungs so the table has
// something in it besides inlay values. The three ores are ultracommon and nearly worthless raw —
// their whole value is on the far side of a smelt (docs/tags.yaml's Mining catalog comment).
const PROSPECTING_TABLE = {
  ultracommon: ["hematite", "malachite", "garnierite"],
  common: ["citrine", "milk-quartz", "onyx", "moonstone", "pyrite", "white-jade"],
  uncommon: ["silver", "fire-opal", "sphalerite", "tetrahedrite", "old-coin"],
  rare: ["opal", "topaz", "amethyst", "kunzite", "purse", "supply-kit"],
  "extremely-rare": ["platinum", "lockbox", "mining-helmet", "jewelry"],
  "nearly-impossible": ["star-sapphire", "black-diamond", "arkenstone"],
};

// Validated once at process startup (bot/src/index.js, web's instrumentation.js), not per roll —
// throwing here means the loot table references something absent from docs/tags.yaml.
async function validateCavingLoot(prisma) {
  const tables = { LOOT_TABLE, PROSPECTING_TABLE };
  const allSlugs = new Set(Object.values(tables).flatMap((table) => Object.values(table).flat()));
  const found = await prisma.tag.findMany({ where: { slug: { in: [...allSlugs] } }, select: { slug: true } });
  const foundSlugs = new Set(found.map((t) => t.slug));
  for (const [name, table] of Object.entries(tables)) {
    const missing = [...new Set(Object.values(table).flat())].filter((s) => !foundSlugs.has(s));
    if (missing.length) {
      throw new Error(`db/lib/cavingLoot.js: ${name} references unknown tag slug(s): ${missing.join(", ")}`);
    }
  }
  for (const [name, map] of Object.entries({ WEIGHTS_BY_ZONE, PROSPECTING_WEIGHTS_BY_ZONE })) {
    for (const [zoneSlug, weights] of Object.entries(map)) {
      const sum = TIERS.reduce((total, tier) => total + (weights[tier] ?? 0), 0);
      if (Math.abs(sum - 1) > 1e-6) {
        throw new Error(`db/lib/cavingLoot.js: ${name}["${zoneSlug}"] sums to ${sum}, not 1`);
      }
    }
  }
}

// The shared draw: land on a tier by cumulative weight, then pick uniformly inside it.
function drawFrom(weights, table) {
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
  const pool = table[tier];
  const slug = pool[Math.floor(Math.random() * pool.length)];
  return { tier, slug };
}

// Draws for the given cave-level zone slug (caves/depths). THROWS on an unknown zone, because
// cavingPass only ever calls it after establishing the Location is CAVE_LEVEL — a zone with no
// column there is a bug, not a quiet no-result.
function drawLoot(zoneSlug) {
  const weights = WEIGHTS_BY_ZONE[zoneSlug];
  if (!weights) throw new Error(`db/lib/cavingLoot.js: no loot weights for zone "${zoneSlug}"`);
  return drawFrom(weights, LOOT_TABLE);
}

// The prospecting twin, and the one place the two differ: this returns NULL for a zone with no
// column rather than throwing. Mining happens in the Black Hills too, and "you dug and found no
// stones" is an ordinary outcome there, not a misconfiguration.
function drawProspectingLoot(zoneSlug) {
  const weights = PROSPECTING_WEIGHTS_BY_ZONE[zoneSlug];
  if (!weights) return null;
  return drawFrom(weights, PROSPECTING_TABLE);
}

module.exports = { LOOT_TABLE, PROSPECTING_TABLE, validateCavingLoot, drawLoot, drawProspectingLoot };
