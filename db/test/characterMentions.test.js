// The mention token's grammar, and the freeze.
//
// WHAT A FAILURE HERE MEANS. `{char:<id>|<Name>}` is the one shape a mention
// is written in, on both faces, and it is now the record of who a line named —
// not a live lookup. Break the grammar and three separate things go wrong
// quietly: the unread dot stops matching (it scans the text), the outbox
// stops rewriting mentions into Discord role pings, and a name a player
// typed can escape into a payload the parser cannot read back.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TOKEN_RE,
  freezeMentionName,
  mentionsCharacter,
  mentionedIdsIn,
  stampMentionNames,
  tokensToNames,
  tokensToRoles,
} = require("../lib/characterMentions");

// Enough of a Prisma client for stampMentionNames: it makes exactly one
// findMany against `character`. The rows are what presentedIdentity reads.
function fakePrisma(rows) {
  return {
    character: {
      findMany: async ({ where }) => rows.filter((r) => where.id.in.includes(r.id)),
    },
  };
}

const plain = (id, name) => ({ id, name, concealed: false, age: 30, gender: "MAN", tags: [] });
const hooded = (id, name) => ({
  id,
  name,
  concealed: true,
  age: 20,
  gender: "WOMAN",
  tags: [{ equipped: true, tag: { forcedName: null, name: "Hood", concealsIdentity: true, concealSprite: "hood", forcesConceal: false, equipLayer: 1 } }],
});
const beast = (id, name) => ({
  id,
  name,
  concealed: false,
  age: 40,
  gender: "MAN",
  tags: [{ equipped: true, tag: { forcedName: "Beast", name: "Apex Form", concealsIdentity: false, concealSprite: null, forcesConceal: false, equipLayer: 0 } }],
});

test("both spellings parse, and a leading token is not special", () => {
  const text = "{char:aaa} said hi to {char:bbb|Sir Alder} and {char:ccc|Young Woman}.";
  assert.deepEqual(
    [...text.matchAll(TOKEN_RE)].map((m) => [m[1], m[2]]),
    [
      ["aaa", undefined],
      ["bbb", "Sir Alder"],
      ["ccc", "Young Woman"],
    ],
  );
  assert.deepEqual(mentionedIdsIn(text), ["aaa", "bbb", "ccc"]);
});

test("a name is sanitised into something the grammar can read back", () => {
  // A disguise name is player-typed and normalizeDisguiseName (disguiseMint.js)
  // only collapses whitespace — so all three of these are reachable today.
  assert.equal(freezeMentionName("Bob}"), "Bob");
  assert.equal(freezeMentionName("a|b"), "ab");
  // The braces are what matters: a name cannot open a token of its own. The
  // colon survives and is harmless — the name half is read to the first `|`
  // or `}`, so `char:evil` is just an odd name.
  assert.equal(freezeMentionName("{char:evil}"), "char:evil");
  assert.equal(freezeMentionName("  Sir   Alder \n"), "Sir Alder");
  assert.equal(freezeMentionName("}|{"), null);
  assert.equal(freezeMentionName(""), null);
  assert.equal(freezeMentionName(null), null);
  assert.equal(freezeMentionName("x".repeat(200)).length, 64);
  // The round trip is the actual promise: whatever comes out has to parse.
  const token = `{char:abc|${freezeMentionName("Bob} |evil")}}`;
  assert.deepEqual([...token.matchAll(TOKEN_RE)].map((m) => [m[1], m[2]]), [["abc", "Bob evil"]]);
});

test("mentionsCharacter knows both spellings and does not match a prefix", () => {
  assert.equal(mentionsCharacter("hi {char:abc}", "abc"), true);
  assert.equal(mentionsCharacter("hi {char:abc|Bob}", "abc"), true);
  assert.equal(mentionsCharacter("hi {char:abc|Bob}", "ab"), false);
  assert.equal(mentionsCharacter("hi {char:abcdef}", "abc"), false);
  assert.equal(mentionsCharacter("hi there", "abc"), false);
  assert.equal(mentionsCharacter(null, "abc"), false);
});

test("the stamp writes the PRESENTED name, never the real one", async () => {
  const prisma = fakePrisma([plain("p1", "Sir Alder"), hooded("h1", "Cersei"), beast("b1", "Jorren Vask")]);
  const out = await stampMentionNames(prisma, "{char:p1} {char:h1} {char:b1}");
  // A hood freezes as its alias and a forced name as itself — a row must never
  // print a name the room could not have heard.
  assert.equal(out, "{char:p1|Sir Alder} {char:h1|Young Woman} {char:b1|Beast}");
});

test("the stamp OVERWRITES a name the client sent", async () => {
  // A server action is a public endpoint: the composer writes the name in so
  // the draft reads right, and it is a claim until the server re-resolves it.
  const prisma = fakePrisma([plain("p1", "Sir Alder")]);
  const out = await stampMentionNames(prisma, "{char:p1|The Baroness}");
  assert.equal(out, "{char:p1|Sir Alder}");
});

test("a mention of somebody gone keeps whatever name it had", async () => {
  const prisma = fakePrisma([]);
  assert.equal(await stampMentionNames(prisma, "{char:ghost|Old Tom}"), "{char:ghost|Old Tom}");
  assert.equal(await stampMentionNames(prisma, "{char:ghost}"), "{char:ghost}");
});

test("text with no mention is returned untouched, without a query", async () => {
  const prisma = {
    character: {
      findMany: async () => {
        throw new Error("stampMentionNames queried for a line with no mention in it");
      },
    },
  };
  assert.equal(await stampMentionNames(prisma, "just talking"), "just talking");
});

// The third spelling, for text that is about to be destroyed on purpose (db/lib/shout.js muffles a shout at
// two hops out). A token survives muffle() as broken braces around a perfectly legible name, which is the one
// word the distance was meant to take away — so it is flattened to prose first.
test("tokensToNames flattens a token to the name it froze", () => {
  assert.equal(tokensToNames("hey {char:p1|The Baroness}, over here"), "hey The Baroness, over here");
});

test("a token with no frozen name flattens to someone, never to a raw id", () => {
  assert.equal(tokensToNames("hey {char:p1}"), "hey someone");
});

test("tokensToNames leaves a line with no mention in it exactly as it was", () => {
  assert.equal(tokensToNames("just talking"), "just talking");
  assert.equal(tokensToNames(""), "");
});

test("every token goes, so nothing brace-shaped is left for muffle to shred", () => {
  const flat = tokensToNames("{char:p1|Ada} told {char:h1|Young Woman} and {char:b1}");
  assert.equal(flat, "Ada told Young Woman and someone");
  assert.ok(!flat.includes("{char:"), flat);
});

// The way OUT. A row's token has to become a Discord chip before it is posted, or the braces go out as
// literal text — which is exactly what /ooc did: it posted the body it was handed, so a web-typed mention
// arrived on Discord reading `{char:cl9…|Ada}`.
function fakeRoleset(rows) {
  return {
    character: {
      findMany: async ({ where }) => rows.filter((r) => where.id.in.includes(r.id)),
    },
  };
}
const withRole = (id, name, discordRoleId) => ({
  id,
  name,
  status: "ALIVE",
  discordRoleId,
  discordUserId: `u-${id}`,
  locationId: "loc1",
  zoneId: "z1",
  discordMirrored: true,
});

test("a row token becomes a Discord role mention, and never reaches a channel as braces", async () => {
  const prisma = fakeRoleset([withRole("p1", "Sir Alder", "12345678901234567")]);
  const { content, characters } = await tokensToRoles(prisma, "over here {char:p1|Sir Alder}");
  assert.equal(content, "over here <@&12345678901234567>");
  assert.ok(!content.includes("{char:"), content);
  assert.deepEqual(characters.map((c) => c.id), ["p1"]);
});

test("a character with no role falls back to the frozen name, not to the raw token", async () => {
  const prisma = fakeRoleset([withRole("p1", "Sir Alder", null)]);
  const { content } = await tokensToRoles(prisma, "over here {char:p1|Sir Alder}");
  assert.equal(content, "over here Sir Alder");
});

test("a line with no mention costs no query", async () => {
  const prisma = {
    character: {
      findMany: async () => {
        throw new Error("tokensToRoles queried for a line with no mention in it");
      },
    },
  };
  const { content, characters } = await tokensToRoles(prisma, "just talking");
  assert.equal(content, "just talking");
  assert.deepEqual(characters, []);
});
