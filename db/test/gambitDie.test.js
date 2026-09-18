// node --test over db/lib/gambitDie.js — the rule that a character throws ONE Gambit die
// per turn, however many times their Move is rewritten. Run with `npm test --workspace=db`.
//
// Nothing here touches Prisma. The transaction client is a fake whose whole job is to
// model the unique index on (characterId, turnId), because that index IS the rule: the
// insert is the claim, so the interesting behaviour is entirely in what createMany returns.
const test = require("node:test");
const assert = require("node:assert/strict");

const { ensureGambitDie } = require("../lib/gambitDie");

const LUCKY = [{ tag: { slug: "lucky" } }];

// Stands in for a Prisma transaction client. `rows` is the GambitDie table.
function fakeTx({ held = [] } = {}) {
  const rows = [];
  const dropped = [];
  return {
    rows,
    dropped,
    gambitDie: {
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true, "must be ON CONFLICT DO NOTHING, not a throw");
        let count = 0;
        for (const row of data) {
          if (rows.some((r) => r.characterId === row.characterId && r.turnId === row.turnId)) continue;
          rows.push({ ...row });
          count += 1;
        }
        return { count };
      },
      findUnique: async ({ where: { characterId_turnId: key } }) =>
        rows.find((r) => r.characterId === key.characterId && r.turnId === key.turnId) ?? null,
    },
    characterTag: {
      findFirst: async ({ where }) => (held.includes(where.tag.slug) ? { tagId: where.tag.slug } : null),
    },
    character: { update: async () => ({}) },
    $executeRaw: async () => 0,
    characterTagDrop: { create: async () => ({}) },
  };
}

test("the first call throws a die and writes exactly one row", async () => {
  const tx = fakeTx();
  const got = await ensureGambitDie(tx, { turnId: "t1", character: { id: "c1", tags: [] } });

  assert.equal(got.fresh, true);
  assert.ok(got.die >= 1 && got.die <= 6);
  assert.equal(tx.rows.length, 1);
  assert.equal(tx.rows[0].die, got.die);
});

test("every later call for the same character and turn hands back the SAME die", async () => {
  // The whole design. An edit, a withdraw and re-file, and a GM's kind flip all land here,
  // and if any of them threw again the edit window would be a re-roll button.
  const tx = fakeTx();
  const first = await ensureGambitDie(tx, { turnId: "t1", character: { id: "c1", tags: [] } });

  for (let i = 0; i < 50; i++) {
    const again = await ensureGambitDie(tx, { turnId: "t1", character: { id: "c1", tags: [] } });
    assert.equal(again.die, first.die, "the die moved between calls");
    assert.equal(again.fresh, false, "only the throwing caller is fresh");
  }
  assert.equal(tx.rows.length, 1, "one row per character per turn, forever");
});

test("a different turn, and a different character, each get their own die", async () => {
  const tx = fakeTx();
  await ensureGambitDie(tx, { turnId: "t1", character: { id: "c1", tags: [] } });
  await ensureGambitDie(tx, { turnId: "t2", character: { id: "c1", tags: [] } });
  await ensureGambitDie(tx, { turnId: "t1", character: { id: "c2", tags: [] } });
  assert.equal(tx.rows.length, 3);
});

test("advantage is recorded on the row, and the kept die is the better of the pair", async () => {
  for (let i = 0; i < 100; i++) {
    const tx = fakeTx();
    const got = await ensureGambitDie(tx, { turnId: "t1", character: { id: "c1", tags: LUCKY } });
    assert.equal(tx.rows[0].advantageSource, "lucky");
    assert.equal(tx.rows[0].rolls.length, 2);
    assert.equal(got.die, Math.max(...tx.rows[0].rolls));
  }
});

test("a loser in a race keeps the winner's die", async () => {
  // Two submits landing together: the second createMany returns 0 under the unique index,
  // and everything that follows has to come off the stored row rather than the roll this
  // call made and must now discard.
  const tx = fakeTx();
  tx.rows.push({ characterId: "c1", turnId: "t1", die: 6, rolls: [6, 2], advantageSource: "lucky" });

  const got = await ensureGambitDie(tx, { turnId: "t1", character: { id: "c1", tags: LUCKY } });
  assert.equal(got.die, 6);
  assert.equal(got.source, "lucky");
  assert.equal(got.fresh, false);
  assert.equal(tx.rows.length, 1);
});
