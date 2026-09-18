// node --test over db/lib/miningdropsRarity.js — the tier columns, the
// renormalisation that stops one bucket diluting another, and the two-stage
// draw. Run with `npm test --workspace=db`. Nothing here touches Prisma.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TIERS,
  BANDS,
  COLUMN_BY_ROLL,
  columnFor,
  bandOf,
  bandShares,
  rowShares,
  drawFromPool,
  validateRarityColumns,
} = require("../lib/miningdropsRarity");

const tag = (rarity, slug = rarity) => ({ kind: "TAG", rarity, slug });
const nothing = () => ({ kind: "NOTHING" });
const resources = (n = 1) => ({ kind: "RESOURCES", resourceAmount: n });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("every column sums to 1", () => {
  assert.doesNotThrow(validateRarityColumns);
  for (const roll of Object.keys(COLUMN_BY_ROLL)) {
    const col = COLUMN_BY_ROLL[roll];
    assert.ok(Math.abs(sum(BANDS.map((b) => col[b] ?? 0)) - 1) < 1e-9, `roll ${roll}`);
  }
});

// Faces 2, 3 and 4 got columns when the rarity ladder met Prospecting, which
// authors 98 entries across them — before that they had none and drew
// nothing. Every configured face still has to be able to hand something back,
// and the one face nobody authors must still draw nothing.
test("every configured face can draw, and an unconfigured one cannot", () => {
  for (const roll of [1, 2, 3, 4, 5, 6]) {
    assert.ok(columnFor(roll), `roll ${roll} has no column`);
    assert.ok(drawFromPool([tag("common")], roll), `roll ${roll} drew nothing`);
  }
  assert.equal(columnFor(7), null);
  assert.equal(drawFromPool([tag("common")], 7), null);
});

// Prospecting's three faces are the ones with no pad at all: a prospector who
// rolls a 2 always comes home with something. Face 1 and face 6 miss.
test("the prospecting faces never miss", () => {
  for (const roll of [2, 3, 4, 5]) {
    assert.equal(columnFor(roll).nothing, 0, `roll ${roll} should never miss`);
  }
  assert.ok(columnFor(1).nothing > 0);
  assert.ok(columnFor(6).nothing > 0);
});

test("rarity ascends and the bottom rung is genuinely rare", () => {
  assert.deepEqual(TIERS, [
    "ultracommon",
    "common",
    "uncommon",
    "rare",
    "extremely-rare",
    "nearly-impossible",
  ]);
  for (const roll of Object.keys(COLUMN_BY_ROLL)) {
    const col = COLUMN_BY_ROLL[roll];
    for (let i = 1; i < TIERS.length; i++) {
      assert.ok(col[TIERS[i]] <= col[TIERS[i - 1]], `roll ${roll}: ${TIERS[i]} above ${TIERS[i - 1]}`);
    }
  }
});

test("an absent band's share goes to the commonest one present", () => {
  // Not spread proportionally: that is what would let a lone `rare` in a pool
  // of commons inflate until the word stopped meaning anything.
  const shares = bandShares([tag("ultracommon", "a"), tag("rare", "b")], 6);
  assert.ok(Math.abs(sum([...shares.values()]) - 1) < 1e-9);
  assert.equal(shares.has("common"), false);
  assert.ok(Math.abs(shares.get("rare") - COLUMN_BY_ROLL[6].rare) < 1e-9, "rare keeps its column share");
  assert.ok(shares.get("ultracommon") > 0.9, "the commonest band absorbs the rest");
});

test("a bucket adding a rare entry does not dilute by row count", () => {
  // The bug tiers exist to kill. Under the old uniform draw, adding one entry
  // to a 10-row pool took 1/11th off everything. Here it costs the other
  // bands only the rare band's own slice.
  const before = rowShares([tag("common", "a"), tag("common", "b")], 6);
  const after = rowShares([tag("common", "a"), tag("common", "b"), tag("rare", "c")], 6);
  // The two commons still split the common band; they lose only what `rare`
  // takes, not a third each.
  assert.ok(after[0] > before[0] * 0.8, `${after[0]} vs ${before[0]}`);
  assert.ok(after[2] < 0.1, "a rare entry stays rare");
});

test("nothing holds its authored share whatever else is in the pool", () => {
  // "How often does a 1 miss" is a fact about the face, not about how many
  // wounds happen to be authored under it. This is what let all 53 pads go.
  for (const extra of [[tag("common")], [tag("common"), tag("rare"), tag("uncommon")]]) {
    const pool = [nothing(), ...extra];
    const shares = bandShares(pool, 1);
    assert.ok(Math.abs(shares.get("nothing") - COLUMN_BY_ROLL[1].nothing) < 1e-9);
  }
});

test("a pool of nothing but pad is a guaranteed miss", () => {
  const shares = bandShares([nothing()], 6);
  assert.equal(shares.get("nothing"), 1);
});

test("a database row and a YAML row name the same band", () => {
  // Postgres hands back the MiningDropRarity enum, the YAML hands back what
  // the author typed. Matching only one spelling meant every live row fell
  // out of every band and could never be drawn at all.
  assert.equal(bandOf({ kind: "TAG", rarity: "EXTREMELY_RARE" }), "extremely-rare");
  assert.equal(bandOf({ kind: "TAG", rarity: "extremely-rare" }), "extremely-rare");
  assert.equal(bandOf({ kind: "TAG", rarity: "COMMON" }), "common");
  // And a name from neither vocabulary is no band, not a guess.
  assert.equal(bandOf({ kind: "TAG", rarity: "quite-rare" }), null);
});

test("⬢ and pads sit outside the rarity ladder", () => {
  assert.equal(bandOf(nothing()), "nothing");
  assert.equal(bandOf(resources(2)), "resources");
  assert.equal(bandOf(tag("rare")), "rare");
  // A row with no rarity and no structural kind contributes nothing rather
  // than silently landing in a band.
  assert.equal(bandOf({ kind: "TAG" }), null);
});

test("a band's members are equally likely once the band is picked", () => {
  const pool = [tag("common", "a"), tag("common", "b"), tag("common", "c")];
  const shares = rowShares(pool, 6);
  assert.ok(Math.abs(shares[0] - shares[1]) < 1e-9);
  assert.ok(Math.abs(shares[1] - shares[2]) < 1e-9);
});

test("row shares sum to 1 over a pool", () => {
  const pool = [nothing(), resources(1), tag("ultracommon"), tag("rare"), tag("nearly-impossible")];
  assert.ok(Math.abs(sum(rowShares(pool, 6)) - 1) < 1e-9);
});

test("the draw lands where the shares say", () => {
  const pool = [nothing(), tag("common", "fish"), tag("nearly-impossible", "grenade")];
  const shares = rowShares(pool, 6);
  // rand() is consumed twice: once to pick the band, once inside it.
  const at = (r) => drawFromPool(pool, 6, () => r);
  assert.equal(at(0.0).kind, "NOTHING");
  assert.equal(at(0.5).slug, "fish");
  // The very top of the range is the rarest band.
  assert.equal(at(0.999999).slug, "grenade");
  assert.ok(shares[2] < shares[1], "the grenade is rarer than the fish");
});

test("a rand of exactly 1 still draws rather than returning null", () => {
  // Float drift at the tail is a real case, and a die that answers null on a
  // pool with entries would silently eat somebody's find.
  const pool = [tag("common", "a"), tag("rare", "b")];
  assert.notEqual(drawFromPool(pool, 6, () => 1), null);
});

test("an empty pool draws nothing at all", () => {
  assert.equal(drawFromPool([], 6), null);
  assert.equal(drawFromPool([{ kind: "TAG" }], 6), null);
});

test("the bottom rung is near a tenth of a percent per labor", () => {
  // The grenade's whole reason for existing. A face is 1-in-6, and the pool
  // it lands in is small, so this is the figure Bascinet asked for.
  const pool = [nothing(), resources(1), tag("common", "fish"), tag("nearly-impossible", "grenade")];
  const perLabor = rowShares(pool, 6)[3] / 6;
  assert.ok(perLabor > 0.0005 && perLabor < 0.003, `${(perLabor * 100).toFixed(3)}%`);
});
