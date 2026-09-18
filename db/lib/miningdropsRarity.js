// The mining drop die's rarity ladder — the six tiers from db/lib/cavingLoot.js, plus two structural bands, one probability column per die face. WHY: the die used to draw UNIFORMLY over the concatenation of whichever scope buckets matched (docs/systemdocs/MININGDROPS.md §2), which meant nothing could be rarer than 1/poolsize, every bucket needed its own `nothing` pad (53 of 180 entries were pads, MININGDROPS.md's footgun), and a bucket DILUTED its neighbours (the only global roll-6 entry was a certainty in a thin pool and 1-in-23 in a crowded one). A tier column fixes all three: the tier's share is fixed, so a bucket contributing a `rare` takes that tier's slice rather than a share proportional to whatever else is stacked beside it.
// KEYED BY FACE, where cavingLoot keys by zone — a 1 and a 6 are different events (face-1 pools were 50-70% pads, face-6 pools 0-50%; one column would roughly double the wound rate and cut every payout by a third). Faces 2-4 have no column and no entries — a labourer rolling one finds nothing, exactly as before. Bascinet owns these numbers; nothing else in the file is a judgement call.

// Ascending rarity. The six names are cavingLoot.js's, deliberately — two loot systems in one game shouldn't speak two vocabularies. The NUMBERS are not shared: a cave 6 and a mining 6 are different events.
const TIERS = ["ultracommon", "common", "uncommon", "rare", "extremely-rare", "nearly-impossible"];

// Two bands that aren't rarities. `nothing` is the pad, now authored once here instead of 53 times in the YAML. `resources` is a ⬢ delta, not an item, with no business competing on a rarity ladder — without its own band a lone "+1" inherits whichever tier it landed in and can take 40% of a pool.
const NOTHING = "nothing";
const RESOURCES = "resources";
const BANDS = [NOTHING, RESOURCES, ...TIERS];

// One column per configured face. Each sums to 1, checked by validateRarityColumns and by db/test/miningDrops.test.js.
const COLUMN_BY_ROLL = Object.freeze({
  // The mishap face. The old pools missed 30-50% of the time (mean 47%), so 0.45 lands where they already were; the worse the wound, the rarer.
  1: Object.freeze({
    nothing: 0.45,
    resources: 0.065,
    ultracommon: 0.18,
    common: 0.165,
    uncommon: 0.095,
    rare: 0.027,
    "extremely-rare": 0.013,
    "nearly-impossible": 0.005,
  }),
  // PROSPECTING'S THREE FACES (2, 3, 4), added when the cooking branch's rarity ladder met master's Prospecting rework — without a column here a two-stage draw means they draw NOTHING, silently deleting the whole specialization's payout. Shaped on face 5 rather than face 6: not one of the 98 entries master authored across these faces is a `nothing` pad, so a prospector who rolls a 2 always comes back with something (`nothing: 0`), and the tiers keep face 5's proportions. They differ only in how far up the ladder they reach — a 2 is an ordinary day's find, a 3 a better one, a 4 the seam you were hoping for. Bascinet owns these numbers like the rest of the file — tune the top three bands, not the shape.
  2: Object.freeze({
    nothing: 0,
    resources: 0.12,
    ultracommon: 0.34,
    common: 0.31,
    uncommon: 0.16,
    rare: 0.05,
    "extremely-rare": 0.018,
    "nearly-impossible": 0.002,
  }),
  3: Object.freeze({
    nothing: 0,
    resources: 0.11,
    ultracommon: 0.3,
    common: 0.29,
    uncommon: 0.18,
    rare: 0.09,
    "extremely-rare": 0.027,
    "nearly-impossible": 0.003,
  }),
  4: Object.freeze({
    nothing: 0,
    resources: 0.1,
    ultracommon: 0.29,
    common: 0.26,
    uncommon: 0.19,
    rare: 0.11,
    "extremely-rare": 0.046,
    "nearly-impossible": 0.004,
  }),
  // Configured for Depths hunting alone, and it never misses: a 5 down there is a body, every time (MININGDROPS.md §8).
  5: Object.freeze({
    nothing: 0,
    resources: 0.1,
    ultracommon: 0.28,
    common: 0.28,
    uncommon: 0.18,
    rare: 0.09,
    "extremely-rare": 0.065,
    "nearly-impossible": 0.005,
  }),
  // The find face. The old pools missed 0-50%, mean 13%.
  6: Object.freeze({
    nothing: 0.15,
    resources: 0.2,
    ultracommon: 0.24,
    common: 0.2,
    uncommon: 0.13,
    rare: 0.06,
    "extremely-rare": 0.016,
    "nearly-impossible": 0.004,
  }),
});

function columnFor(roll) {
  return COLUMN_BY_ROLL[roll] ?? null;
}

// A row's band: its authored rarity, or the band its kind puts it in. NOTHING and RESOURCES rows carry no rarity at all — the sync refuses one on them.
// CASE-INSENSITIVE, and that's not politeness: a row read back from Postgres carries the MiningDropRarity enum ("EXTREMELY_RARE"), a row parsed straight out of docs/miningdrops.yaml carries what the author typed ("extremely-rare") — both are the same band. Matching only the YAML spelling meant every live row fell out of every band and could never be drawn, which the pure tests couldn't see since they build rows by hand.
function bandOf(row) {
  if (row?.kind === "NOTHING") return NOTHING;
  if (row?.kind === "RESOURCES") return RESOURCES;
  const raw = row?.rarity;
  if (!raw) return null;
  const name = String(raw).toLowerCase().replace(/_/g, "-");
  return BANDS.includes(name) ? name : null;
}

// The heart of it: what share of a draw each band actually gets, given the pool that turned up. RARITY IS ABSOLUTE — a `rare` entry is worth its column share whatever else is authored beside it, which is what makes the word mean something across 23 pools of wildly different sizes and stops one bucket diluting another. The probability of bands NOBODY authored flows to the COMMONEST band present, never spread proportionally — spreading it would let a lone `rare` in a pool of commons inflate to 23%, a tier name lying about itself.
// cavingLoot.js needs none of this because its six tiers are always populated; here a pool is often two or three bands wide, so the leftover is most of the column and where it lands is the whole design. `nothing` is fixed first and separately, since "how often does a 1 miss" is a fact about the face rather than what's authored beneath it — that's what let all 53 pads out of the YAML. Returns a Map of band -> probability, summing to 1 over the bands present; an empty pool returns an empty Map and the caller draws nothing.
function bandShares(pool, roll) {
  const column = columnFor(roll);
  const shares = new Map();
  if (!column || !pool?.length) return shares;

  const counts = new Map();
  for (const row of pool) {
    const band = bandOf(row);
    if (!band) continue;
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }
  if (counts.size === 0) return shares;

  const nothingShare = counts.has(NOTHING) ? column[NOTHING] : 0;
  const live = BANDS.filter((b) => b !== NOTHING && counts.has(b));

  if (!live.length) {
    // Pad and nothing else authored: the face is a guaranteed miss.
    shares.set(NOTHING, 1);
    return shares;
  }

  if (nothingShare) shares.set(NOTHING, nothingShare);
  for (const b of live) shares.set(b, column[b]);

  // Whatever the absent bands would have taken goes to the commonest TIER present, never to `resources` — a ⬢ delta holds exactly its authored share since it's a consolation prize, and letting it absorb the leftover would make it the likeliest outcome of half the pools in the table. Only if a pool has no tiers at all does `resources` take the slack, since then there's nowhere else.
  const claimed = nothingShare + live.reduce((sum, b) => sum + column[b], 0);
  const leftover = 1 - claimed;
  if (leftover > 0) {
    const commonest = live.find((b) => TIERS.includes(b)) ?? live[0];
    shares.set(commonest, shares.get(commonest) + leftover);
  } else if (leftover < 0) {
    // Can only happen if a column is mis-authored; validateRarityColumns is the real guard, but never hand back negative probability.
    const scale = (1 - nothingShare) / (claimed - nothingShare);
    for (const b of live) shares.set(b, column[b] * scale);
  }
  return shares;
}

// What ONE row's chance is, within its pool. The band's share split evenly among that band's members — the same second stage cavingLoot.js uses, where a tier's slugs are equally likely once the tier is picked. This is what the audit and the annotate hook price with, so a per-entry number printed into docs/miningdrops.yaml is the number the draw uses.
function rowShares(pool, roll) {
  const shares = bandShares(pool, roll);
  const members = new Map();
  for (const row of pool) {
    const band = bandOf(row);
    if (!band) continue;
    members.set(band, (members.get(band) ?? 0) + 1);
  }
  return pool.map((row) => {
    const band = bandOf(row);
    const share = shares.get(band) ?? 0;
    return share / (members.get(band) || 1);
  });
}

// Two-stage draw, mirroring cavingLoot.js#drawLoot: land on a band, then pick uniformly inside it. `rand` is injectable so the tests can be deterministic rather than statistical.
function drawFromPool(pool, roll, rand = Math.random) {
  const shares = bandShares(pool, roll);
  if (shares.size === 0) return null;

  let r = rand();
  let chosen = null;
  for (const [band, share] of shares) {
    if (r < share) {
      chosen = band;
      break;
    }
    r -= share;
  }
  // Float drift at the tail, or a rand() of exactly 1: take the last band rather than returning null on a pool that plainly has entries.
  if (chosen === null) chosen = [...shares.keys()].pop();

  const members = pool.filter((row) => bandOf(row) === chosen);
  if (!members.length) return null;
  return members[Math.floor(rand() * members.length)] ?? members[members.length - 1];
}

// Every column sums to 1, the way validateCavingLoot checks its own. Called from the test rather than at startup: this file is data, and a bad column should fail the build, not the next player's roll.
function validateRarityColumns() {
  for (const [roll, column] of Object.entries(COLUMN_BY_ROLL)) {
    const unknown = Object.keys(column).filter((b) => !BANDS.includes(b));
    if (unknown.length) {
      throw new Error(`miningdropsRarity: roll ${roll} column has unknown band(s): ${unknown.join(", ")}`);
    }
    const sum = BANDS.reduce((total, b) => total + (column[b] ?? 0), 0);
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`miningdropsRarity: roll ${roll} column sums to ${sum}, not 1`);
    }
  }
}

module.exports = {
  TIERS,
  BANDS,
  NOTHING,
  RESOURCES,
  COLUMN_BY_ROLL,
  columnFor,
  bandOf,
  bandShares,
  rowShares,
  drawFromPool,
  validateRarityColumns,
};
