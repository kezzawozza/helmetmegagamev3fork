// The one policy the three sendDm transports share (db/lib/dmPolicy.js) —
// the `»` prefix, the NOTICE default and the row shape. These assertions
// notice the next drift between them.
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyDmPrefix, dmLogRow, dedupeKey, describeFailure, DEFAULT_KIND } = require("../lib/dmPolicy");
const { DM_KIND } = require("../lib/dmKinds");

test("the » prefix is idempotent", () => {
  assert.equal(applyDmPrefix("hello"), "» hello");
  assert.equal(applyDmPrefix("» hello"), "» hello"); // /dm writes its own chevron; two would quote a quote
  assert.equal(applyDmPrefix(""), "» ");
  assert.equal(applyDmPrefix(null), "» ");
});

test("subtext keeps its own voice", () => {
  // `» -# …` would be the game quoting you and the world murmuring at once.
  const line = "-# GMs are only available to solve unintended bugs";
  assert.equal(applyDmPrefix(line), line);
});

test("dmPolicy's copy of the kind strings still matches dmKinds", () => {
  assert.equal(DEFAULT_KIND, DM_KIND.NOTICE);
  assert.equal(dmLogRow({ discordUserId: "u", content: "x" }).kind, DM_KIND.NOTICE);
  assert.equal(dmLogRow({ discordUserId: "u", content: "x", hasEmbeds: true }).kind, DM_KIND.QUIET);
  assert.equal(
    dmLogRow({ discordUserId: "u", content: "x", opts: { kind: DM_KIND.CONVERSATION } }).kind,
    DM_KIND.CONVERSATION,
  );
  assert.equal( // explicit kind beats the embed default
    dmLogRow({ discordUserId: "u", content: "x", hasEmbeds: true, opts: { kind: DM_KIND.CONVERSATION } }).kind,
    DM_KIND.CONVERSATION,
  );
});

test("the log row's defaults are the same for every transport", () => {
  const row = dmLogRow({ discordUserId: "u1", content: "» hi", discordMessageId: "m1" });
  assert.equal(row.direction, "OUTBOUND");
  assert.equal(row.source, "bot_auto");
  assert.equal(row.authorDiscordUserId, null);
  assert.equal(row.clientNonce, null);
  assert.equal(row.discordMessageId, "m1");
  assert.equal(row.meta, undefined); // never null: Prisma rejects an explicit null for a Json? column
});

test("a dedupe key is built from ids, so it survives a reordered recipient list", () => {
  const a = dedupeKey({ scope: "staged", subjectId: "msg1", discordUserId: "u1" });
  assert.equal(a, "staged:msg1:u1");
  assert.equal(a, dedupeKey({ scope: "staged", subjectId: "msg1", discordUserId: "u1" }));
  assert.notEqual(a, dedupeKey({ scope: "staged", subjectId: "msg1", discordUserId: "u2" }));
  assert.equal(dedupeKey({ scope: "staged", subjectId: "msg1" }), "staged:msg1:none"); // PUBLIC row, no recipient
});

test("a failure is described the same way wherever it is caught", () => {
  const err = Object.assign(new Error("Cannot send messages to this user"), { status: 403, code: 50007 });
  assert.deepEqual(describeFailure(err), {
    error: "Cannot send messages to this user",
    status: 403,
  });
  assert.deepEqual(describeFailure(new Error("boom")), { error: "boom", status: null });
  assert.deepEqual(describeFailure("boom"), { error: "boom", status: null });
  assert.deepEqual(describeFailure(null), { error: "unknown error", status: null });
});
