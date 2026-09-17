// The turret's ballistics: what a burst does to a sheet. db/lib/turretPass.js is the trigger, this is
// the damage — Bascinet's only automated harm mechanic. Reads FACES, not papers: spares exactly a
// character whose PRESENTED name matches Depot.merchantFace, so a concealed Merchant is shot by his
// own gun. Armour bends a CURVE via Tag.ballisticArmor (db/lib/armorValue.js), not a hardcoded slug list.

const { combineArmor } = require("./armorValue");

// Worst to best. `null` is a clean miss with a story attached; `dead` is handled by the caller.
const TURRET_SEVERITIES = ["graze", "minor-wound", "deep-wound", "grievous-wound", "dying", "dead"];

// The tag each severity applies. Graze marks nobody; dead is the caller's problem.
const TURRET_SEVERITY_TAGS = {
  graze: null,
  "minor-wound": "minor-wound",
  "deep-wound": "deep-wound",
  "grievous-wound": "grievous-wound",
  dying: "dying",
  dead: null,
};

// Unarmoured: ~a tenth dodges outright, a third wounded, three fifths dying or dead — meant to be
// close to fatal. `graze` is a FLAT DODGE (see rollTurret), not the mild end of the curve. Sums to 1.
const DEFAULT_TURRET_TABLE = {
  graze: 0.1,
  "minor-wound": 0.036,
  "deep-wound": 0.09,
  "grievous-wound": 0.162,
  dying: 0.198,
  dead: 0.414,
};

// Armour bends the curve as an exponent (1 + ARMOR_GAIN * odds), not a subtraction, so it never closes
// the top of the distribution — "a jacket that makes a machinegun safe" is a worse rule than any
// number could fix. Uses ODDS (armorOdds() below), not raw protection, so armour tiers separate instead
// of bunching near ARMOR_CAP. At 0.25: nothing 39%, plate 41%, light infantry 57%, heavy 73%, cataphract
// 79-84% survival.
const ARMOR_GAIN = 0.25;

// Protection as odds. Guarded at 1 so a bare 1.0 gives a large number rather than a division by zero.
function armorOdds(protection) {
  const p = Math.min(0.999, Math.max(0, protection));
  return p / (1 - p);
}

// The shipped table, always — not GM-editable, and there is no column behind it
// either (`Depot.turretTable` never existed; the old comment here said it was an
// orphan column, which was wrong in a way that read as though one could be
// written). Argument kept so every caller and the Gatehouse turret's `null`
// still work unchanged.
function turretTable(_depot) {
  return DEFAULT_TURRET_TABLE;
}

// One shot. `rng` is injectable so a test can pin the outcome; nothing in production passes it.
function rollTurret(characterTags, depot, rng = Math.random) {
  const protection = combineArmor(characterTags, "ballisticArmor");
  const table = turretTable(depot);

  // Flat dodge, first and outside the bend — same rate for everyone.
  const grazeFloor = table.graze ?? 0;
  if (rng() < grazeFloor) return { severity: "graze", protection, tagSlug: null };

  // Wound bands, renormalised over what's left once the dodge is spent.
  const wounds = TURRET_SEVERITIES.filter((s) => s !== "graze");
  const mass = wounds.reduce((sum, s) => sum + (table[s] ?? 0), 0);
  if (mass <= 0) return { severity: "graze", protection, tagSlug: null };

  const bent = Math.pow(rng(), 1 + ARMOR_GAIN * armorOdds(protection));

  let roll = bent;
  for (const severity of wounds) {
    roll -= (table[severity] ?? 0) / mass;
    if (roll <= 0) {
      return { severity, protection, tagSlug: TURRET_SEVERITY_TAGS[severity] };
    }
  }
  // Only reachable on a table summing under 1; falling out as a graze is the harmless direction.
  return { severity: "graze", protection, tagSlug: null };
}

// Case-insensitive match on trimmed presented name. An empty merchantFace spares nobody — the safe
// failure for a gun that must be deliberately armed.
function turretSpares(presentedName, depot) {
  const face = String(depot?.merchantFace ?? "").trim().toLowerCase();
  if (!face) return false;
  return String(presentedName ?? "").trim().toLowerCase() === face;
}

module.exports = {
  turretTable,
  rollTurret,
  turretSpares,
};
