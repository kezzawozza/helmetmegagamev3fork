// db/lib/discordAccounts.js caches the Discord handle behind each account, so
// a GM can search "peace.lock" instead of a snowflake. The mapping and the
// drift diff are pure, so no database and no stub — same posture as curse.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  accountRowsFromMembers,
  diffAccountRows,
  normalizeHandle,
} = require("../lib/discordAccounts");

// Shaped like a discord.js GuildMember, only the fields the mapper reads.
const member = (id, username, { globalName = null, bot = false } = {}) => ({
  id,
  user: { id, username, globalName, bot },
});

// ─── normalizeHandle ────────────────────────────────────────────────────────

test("a handle normalizes for lookup, case and padding", () => {
  assert.equal(normalizeHandle("  Peace.Lock  "), "peace.lock");
});

test("a leading @ is not part of the handle", () => {
  assert.equal(normalizeHandle("@peace.lock"), "peace.lock");
});

test("a missing handle normalizes to null rather than an empty string", () => {
  assert.equal(normalizeHandle(""), null);
  assert.equal(normalizeHandle(null), null);
  assert.equal(normalizeHandle(undefined), null);
});

// ─── accountRowsFromMembers ─────────────────────────────────────────────────

test("a member becomes a row carrying handle and display name", () => {
  const rows = accountRowsFromMembers([member("1", "peace.lock", { globalName: "Bascinet" })]);
  assert.deepEqual(rows, [{ discordUserId: "1", username: "peace.lock", globalName: "Bascinet" }]);
});

test("no global name stores null, not the handle over again", () => {
  const [row] = accountRowsFromMembers([member("1", "peace.lock")]);
  assert.equal(row.globalName, null);
});

test("bots are skipped — they are not players and would pad the table", () => {
  const rows = accountRowsFromMembers([
    member("1", "peace.lock"),
    member("2", "lifeweb-bot", { bot: true }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.discordUserId),
    ["1"],
  );
});

test("a member with no username at all is dropped, not stored blank", () => {
  const rows = accountRowsFromMembers([member("1", ""), member("2", "real.handle")]);
  assert.deepEqual(
    rows.map((r) => r.discordUserId),
    ["2"],
  );
});

test("the same account twice keeps one row — a fetch can repeat a member", () => {
  const rows = accountRowsFromMembers([member("1", "peace.lock"), member("1", "peace.lock")]);
  assert.equal(rows.length, 1);
});

// Two callers, two shapes: discord.js hands back `globalName`, the REST list
// the mirror already holds hands back `global_name`. Reading only one silently
// blanks every display name from the other and rewrites the row every pass.
test("a REST member's snake_case global_name is read too", () => {
  const rest = { user: { id: "1", username: "peace.lock", global_name: "Bascinet", bot: false } };
  const [row] = accountRowsFromMembers([rest]);
  assert.equal(row.globalName, "Bascinet");
});

test("a REST bot is skipped like a gateway one", () => {
  const rest = { user: { id: "2", username: "lifeweb-bot", bot: true } };
  assert.deepEqual(accountRowsFromMembers([rest]), []);
});

// ─── diffAccountRows ────────────────────────────────────────────────────────

const incoming = [
  { discordUserId: "1", username: "peace.lock", globalName: "Bascinet" },
  { discordUserId: "2", username: "sds2413", globalName: null },
];

test("an unknown account is created", () => {
  const { toCreate, toUpdate } = diffAccountRows(incoming, []);
  assert.equal(toCreate.length, 2);
  assert.equal(toUpdate.length, 0);
});

test("an unchanged account is neither created nor updated", () => {
  const { toCreate, toUpdate } = diffAccountRows(incoming, incoming);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 0);
});

test("a renamed handle is an update, not a second row", () => {
  const existing = [{ discordUserId: "1", username: "old.handle", globalName: "Bascinet" }];
  const { toCreate, toUpdate } = diffAccountRows([incoming[0]], existing);
  assert.equal(toCreate.length, 0);
  assert.deepEqual(toUpdate, [incoming[0]]);
});

test("a changed display name alone still counts as drift", () => {
  const existing = [{ discordUserId: "1", username: "peace.lock", globalName: "Old Name" }];
  const { toUpdate } = diffAccountRows([incoming[0]], existing);
  assert.equal(toUpdate.length, 1);
});

test("a display name going away is drift too, not a no-op", () => {
  const existing = [{ discordUserId: "2", username: "sds2413", globalName: "Had One" }];
  const { toUpdate } = diffAccountRows([incoming[1]], existing);
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0].globalName, null);
});

test("an account we no longer see is left alone — a departure is not a delete", () => {
  const existing = [
    ...incoming,
    { discordUserId: "9", username: "left.the.guild", globalName: null },
  ];
  const { toCreate, toUpdate } = diffAccountRows(incoming, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 0);
});
