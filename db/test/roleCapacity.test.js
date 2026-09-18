// Which seats reopen when their holder dies. Getting this backwards either
// refills the roster for free — a Merchant dies and another walks in — or
// locks the last two seats nobody can ever be locked out of.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  roleCapacity,
  isPermanentSeat,
  seatHolderStatuses,
  REOPENING_SEAT_ROLE_SLUGS,
} = require("../lib/roleCapacity");

test("only Bum and Migrant hand their seat back", () => {
  assert.deepEqual(REOPENING_SEAT_ROLE_SLUGS, ["bum", "migrant"]);
  assert.deepEqual(seatHolderStatuses({ slug: "bum" }), ["ALIVE"]);
  assert.deepEqual(seatHolderStatuses({ slug: "migrant" }), ["ALIVE"]);
});

test("every other seat stays spent", () => {
  for (const slug of ["merchant", "cerberus", "baron", "docker", "mortus"]) {
    assert.equal(isPermanentSeat({ slug }), true, slug);
    assert.deepEqual(seatHolderStatuses({ slug }), ["ALIVE", "DEAD"], slug);
  }
});

test("an unknown slug is treated as permanent, not as free", () => {
  assert.equal(isPermanentSeat({ slug: "not-a-role" }), true);
  assert.equal(isPermanentSeat(null), true);
});

test("capacity itself is unchanged", () => {
  assert.equal(roleCapacity({ isUnique: true }, 100), 1);
  assert.equal(roleCapacity({ unlimited: true }, 100), Infinity);
  assert.equal(roleCapacity({ weight: 4 }, 100), 4);
  assert.equal(roleCapacity({ weight: 1 }, 10), 1); // never rounds below 1
});
