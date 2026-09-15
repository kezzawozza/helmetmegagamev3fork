// db/lib/deathTeardown.js#stillAlive answers "does this Discord user already
// control a different living character" — the exact predicate
// db/lib/reincarnate.js uses to avoid re-ghosting a reborn player, and
// web/lib/notifyCharacter.js now uses to stop DMing someone about a corpse
// they've moved on from. A wrong answer here either strands a reborn player
// in the dead room or keeps mailing them about their old body. Pure over a
// fake prisma, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { stillAlive } = require("../lib/deathTeardown");

test("false with no discordUserId, and the database is never asked", async () => {
  let called = false;
  const prisma = { character: { count: async () => ((called = true), 0) } };
  assert.equal(await stillAlive(prisma, null), false);
  assert.equal(called, false);
});

test("false when nobody else is ALIVE for that user", async () => {
  const prisma = { character: { count: async () => 0 } };
  assert.equal(await stillAlive(prisma, "u"), false);
});

test("true when a living character is found", async () => {
  let asked = null;
  const prisma = { character: { count: async (args) => ((asked = args), 1) } };
  assert.equal(await stillAlive(prisma, "u"), true);
  assert.deepEqual(asked.where, { discordUserId: "u", status: "ALIVE" });
});

test("a rejected query fails to false rather than throwing", async () => {
  const prisma = { character: { count: async () => { throw new Error("db down"); } } };
  assert.equal(await stillAlive(prisma, "u"), false);
});
