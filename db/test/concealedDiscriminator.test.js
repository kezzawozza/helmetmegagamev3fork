// The invisible per-scene discriminator appended to a concealed webhook
// username. See db/lib/concealedDiscriminator.js.
const test = require("node:test");
const assert = require("node:assert/strict");

const { concealDiscriminator, ZWSP, ZWNJ } = require("../lib/concealedDiscriminator");

test("deterministic — same inputs, same output", () => {
  const a = concealDiscriminator({ characterId: "abc123", turnNumber: 5, placeKey: "zone:town" });
  const b = concealDiscriminator({ characterId: "abc123", turnNumber: 5, placeKey: "zone:town" });
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test("different characters in the same (turn, place) usually differ", () => {
  // 6 bits = 64 buckets, so a birthday collision between two ids is ~1/64.
  // Sample a spread of ids and confirm the space is used.
  const suffixes = new Set();
  for (let i = 0; i < 32; i += 1) {
    suffixes.add(concealDiscriminator({ characterId: `char-${i}`, turnNumber: 5, placeKey: "zone:town" }));
  }
  // We expect near 32 distinct values from 32 samples; anything under 20
  // means the hash is not spreading.
  assert.ok(suffixes.size >= 20, `only ${suffixes.size} distinct suffixes for 32 ids`);
});

test("same character across two turns differs — no cross-turn fingerprint", () => {
  const t1 = concealDiscriminator({ characterId: "abc123", turnNumber: 5, placeKey: "zone:town" });
  const t2 = concealDiscriminator({ characterId: "abc123", turnNumber: 6, placeKey: "zone:town" });
  // A 6-bit hash has a 1/64 chance of colliding on turn advance, which would
  // read as an off-by-one turn's stability rather than a stable fingerprint.
  // Assert that the two are usually different, which is what the design buys.
  assert.notEqual(t1, t2);
});

test("only zero-width chars — nothing visible ever leaks", () => {
  for (let i = 0; i < 16; i += 1) {
    const s = concealDiscriminator({ characterId: `char-${i}`, turnNumber: i, placeKey: `key-${i}` });
    for (const ch of s) {
      assert.ok(ch === ZWSP || ch === ZWNJ, `unexpected char ${ch.charCodeAt(0).toString(16)} in suffix`);
    }
  }
});

test("empty scope — empty suffix", () => {
  assert.equal(concealDiscriminator({ characterId: "abc" }), "");
  assert.equal(concealDiscriminator({ characterId: "abc", turnNumber: null, placeKey: null }), "");
  assert.equal(concealDiscriminator({}), "");
  assert.equal(concealDiscriminator({ characterId: null, turnNumber: 5, placeKey: "zone:town" }), "");
});

test("place scopes the hash — same character, two rooms", () => {
  const a = concealDiscriminator({ characterId: "abc123", turnNumber: 5, placeKey: "loc:pub" });
  const b = concealDiscriminator({ characterId: "abc123", turnNumber: 5, placeKey: "loc:market" });
  assert.notEqual(a, b);
});
