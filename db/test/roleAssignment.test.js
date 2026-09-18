// node --test over the pure roll. Run with `npm test --workspace=db`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { assignRoles } = require("../lib/roleAssignment");

const R = (slug, extra = {}) => ({ slug, name: slug, isUnique: false, unlimited: false, weight: null, requiresWhitelist: false, spawnOnly: false, ...extra });
const ROLES = [
  R("baron", { isUnique: true, requiresWhitelist: true }),
  R("sheriff", { isUnique: true }),
  R("courtier", { weight: 10 }),
  R("migrant", { unlimited: true }),
  R("tribune", { spawnOnly: true }),
];
const P = (id, priorities, extra = {}) => ({ discordUserId: id, priorities, joblessRole: "MIGRANT", whitelisted: false, ...extra });
const roleOf = (out, id) => out.rows.find((r) => r.discordUserId === id).roleSlug;

test("a High beats a Medium for the same unique seat", () => {
  const out = assignRoles({ players: [P("a", { sheriff: "MEDIUM" }), P("b", { sheriff: "HIGH" })], roles: ROLES, playerCount: 10, seed: "x" });
  assert.equal(roleOf(out, "b"), "sheriff");
  assert.equal(roleOf(out, "a"), "migrant");
});

test("a unique seat goes to exactly one player", () => {
  const players = ["a", "b", "c"].map((id) => P(id, { sheriff: "HIGH" }));
  const out = assignRoles({ players, roles: ROLES, playerCount: 10, seed: "x" });
  assert.equal(out.rows.filter((r) => r.roleSlug === "sheriff").length, 1);
});

test("a whitelisted seat needs the role unless the gate is off", () => {
  const players = [P("a", { baron: "HIGH" })];
  const shut = assignRoles({ players, roles: ROLES, playerCount: 10, seed: "x" });
  assert.equal(roleOf(shut, "a"), "migrant");
  const open = assignRoles({ players, roles: ROLES, playerCount: 10, seed: "x", leaderWhitelistEnabled: false });
  assert.equal(roleOf(open, "a"), "baron");
  const wl = assignRoles({ players: [P("a", { baron: "HIGH" }, { whitelisted: true })], roles: ROLES, playerCount: 10, seed: "x" });
  assert.equal(roleOf(wl, "a"), "baron");
});

test("the reserved pass seats a reserved seat before the main pass hands them something else", () => {
  // `a` wants Sheriff High and Baron Medium; the reserved pass runs first at
  // every level, so Baron (Medium, reserved) wins over Sheriff (High, not).
  const out = assignRoles({ players: [P("a", { sheriff: "HIGH", baron: "MEDIUM" }, { whitelisted: true })], roles: ROLES, playerCount: 10, seed: "x" });
  assert.equal(roleOf(out, "a"), "baron");
  assert.equal(out.rows[0].source, "MEDIUM");
});

test("a weighted seat caps at its share of the player count", () => {
  const players = Array.from({ length: 6 }, (_, i) => P(`p${i}`, { courtier: "HIGH" }));
  // weight 10 at 30 players = 3 seats
  const out = assignRoles({ players, roles: ROLES, playerCount: 30, seed: "x" });
  assert.equal(out.rows.filter((r) => r.roleSlug === "courtier").length, 3);
  assert.equal(out.rows.filter((r) => r.roleSlug === "migrant").length, 3);
});

test("seats already taken before the roll count against capacity", () => {
  const out = assignRoles({ players: [P("a", { sheriff: "HIGH" })], roles: ROLES, taken: new Map([["sheriff", 1]]), playerCount: 10, seed: "x" });
  assert.equal(roleOf(out, "a"), "migrant");
});

test("jobless fallbacks: migrant, or back to the lobby", () => {
  const out = assignRoles({
    players: [P("b", {}, { joblessRole: "MIGRANT" }), P("c", {}, { joblessRole: "RETURN_TO_LOBBY" })],
    roles: ROLES, playerCount: 10, seed: "x",
  });
  assert.equal(roleOf(out, "b"), "migrant");
  assert.equal(roleOf(out, "c"), null);
  assert.ok(out.warnings.some((w) => w.includes("return to the lobby")));
});

test("spawn-only seats are never handed out", () => {
  const out = assignRoles({ players: [P("a", { tribune: "HIGH" })], roles: ROLES, playerCount: 10, seed: "x" });
  assert.equal(roleOf(out, "a"), "migrant");
});

test("the same seed rolls the same table", () => {
  const players = Array.from({ length: 12 }, (_, i) => P(`p${i}`, { sheriff: "HIGH", courtier: "MEDIUM" }));
  const a = assignRoles({ players, roles: ROLES, playerCount: 20, seed: "same" });
  const b = assignRoles({ players, roles: ROLES, playerCount: 20, seed: "same" });
  assert.deepEqual(a.rows, b.rows);
  const c = assignRoles({ players, roles: ROLES, playerCount: 20, seed: "other" });
  assert.notDeepEqual(a.rows, c.rows);
});

test("an unwanted reserved seat is a warning, never forced", () => {
  const out = assignRoles({ players: [P("a", { courtier: "HIGH" })], roles: ROLES, playerCount: 10, seed: "x" });
  assert.equal(out.rows.filter((r) => r.roleSlug === "baron").length, 0);
  assert.ok(out.warnings.some((w) => w.includes("baron")));
});
