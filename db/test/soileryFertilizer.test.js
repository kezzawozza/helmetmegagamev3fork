// node --test over db/lib/soilery.js#reap's fertilized branch (SOILERY.md's
// Addendum). Pure and Prisma-free, same posture as soilery.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { reap, BOUNTY_IN } = require("../lib/soilery");

test("reap: unfertilized never exceeds planted", () => {
  const planted = 600;
  const reaped = reap(planted, () => 0.99);
  assert.equal(reaped, planted);
  assert.ok(reap(planted) <= planted);
});

test("reap: fertilized never yields fewer than planted", () => {
  const planted = 600;
  // Never rolls the bounty slot — every unit lands as a plain 1.
  assert.equal(reap(planted, () => 0.99, { fertilized: true }), planted);
});

test("reap: fertilized always rolling the bounty slot doubles everything", () => {
  const planted = 600;
  // floor(0 * BOUNTY_IN) === 0 every time, which is the double branch.
  assert.equal(reap(planted, () => 0, { fertilized: true }), planted * 2);
});

test("reap: fertilized real per-unit variance lands between planted and 2x planted, within 3 std dev of the mean", () => {
  const planted = 6000;
  const reaped = reap(planted, Math.random, { fertilized: true });
  assert.ok(reaped >= planted, `reaped ${reaped} is below planted ${planted} — fertilized never loses a plant`);
  assert.ok(reaped <= planted * 2, `reaped ${reaped} is above the 2x ceiling for ${planted} planted`);
  // Each unit is 1 + Bernoulli(1/BOUNTY_IN), so mean/variance are the mirror
  // of the ordinary wither roll's, offset by `planted`.
  const mean = planted + planted * (1 / BOUNTY_IN);
  const variance = planted * (1 / BOUNTY_IN) * (1 - 1 / BOUNTY_IN);
  const stdDev = Math.sqrt(variance);
  assert.ok(
    Math.abs(reaped - mean) <= 3 * stdDev,
    `reaped ${reaped} is more than 3 std dev (${stdDev.toFixed(1)}) from the expected mean ${mean}`,
  );
});

test("reap: planting 0 fertilized reaps 0, with no rng calls needed", () => {
  assert.equal(reap(0, Math.random, { fertilized: true }), 0);
});
