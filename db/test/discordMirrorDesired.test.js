// desired.js — the database rows turned into "what Discord should look like".
// Pure, so these are fixture rows and nothing else: no guild, no database.
//
// What matters here is that it skips exactly the rows the old destructive zones sync
// skips. A CAVE_GROUP has no #summary and no access role; a CAVE_LEVEL has no
// category, no #summary and no GM seat of its own. Get that wrong and the
// mirror's first apply cuts channels nobody asked for.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DISCORD_GUILD_ID ||= "guild-1";

const { buildDesired } = require("../lib/discordMirror/desired");

const zone = (over = {}) => ({
  id: "z1",
  slug: "town",
  name: "Town",
  kind: "SURFACE",
  sortOrder: 0,
  description: "",
  parentZoneId: null,
  discordRoleId: "role-z1",
  gmRoleId: "role-gm1",
  discordCategoryId: "cat-1",
  discordSummaryChannelId: "sum-1",
  ...over,
});

const location = (over = {}) => ({
  id: "l1",
  slug: "square",
  name: "The Square",
  description: "A wide stone square.",
  sortOrder: 0,
  zoneId: "z1",
  attributes: [],
  discordChannelId: "chan-1",
  anchorMessageId: "msg-1",
  anchorHash: null,
  ...over,
});

const room = (over = {}) => ({
  id: "r1",
  slug: "well",
  name: "The Well",
  description: "Cold water.",
  kind: "PUBLIC",
  sortOrder: 0,
  soundproof: false,
  live: null,
  locationId: "l1",
  discordThreadId: "thr-1",
  starterMessageId: "start-1",
  postHash: null,
  ...over,
});

function build(over = {}) {
  return buildDesired({
    zones: [zone()],
    locations: [location()],
    rooms: [room()],
    config: {},
    spectators: true,
    guildId: "guild-1",
    ...over,
  });
}

const byKind = (targets, kind) => targets.filter((t) => t.kind === kind);

test("a surface zone wants a category, a #summary, an access role and a GM seat", () => {
  const targets = build();
  assert.equal(byKind(targets, "zone-category").length, 1);
  assert.equal(byKind(targets, "zone-summary").length, 1);
  assert.equal(byKind(targets, "zone-role").length, 1);
  assert.equal(byKind(targets, "zone-gm-role").length, 1);
  assert.equal(byKind(targets, "zone-role")[0].name, "Zone: Town");
  assert.equal(byKind(targets, "zone-gm-role")[0].name, "GM: Town");
});

test("a CAVE_GROUP owns the category and nothing else — no #summary, no access role", () => {
  const targets = build({
    zones: [zone({ id: "zg", slug: "underground", name: "Underground", kind: "CAVE_GROUP" })],
    locations: [],
    rooms: [],
  });
  assert.equal(byKind(targets, "zone-category").length, 1);
  assert.equal(byKind(targets, "zone-summary").length, 0);
  assert.equal(byKind(targets, "zone-role").length, 0);
  // It DOES get a GM seat: it owns the category its levels' channels hang under.
  assert.equal(byKind(targets, "zone-gm-role").length, 1);
});

test("a CAVE_LEVEL has no channels of its own and no GM seat — it wears the group's", () => {
  const group = zone({ id: "zg", slug: "underground", name: "Underground", kind: "CAVE_GROUP", discordCategoryId: "cat-u", gmRoleId: "gm-u", discordRoleId: null, discordSummaryChannelId: null });
  const level = zone({ id: "zl", slug: "caves", name: "Caves", kind: "CAVE_LEVEL", parentZoneId: "zg", sortOrder: 1, discordCategoryId: null, discordSummaryChannelId: null });
  const targets = buildDesired({
    zones: [group, level],
    locations: [location({ id: "lc", slug: "pit", name: "The Pit", zoneId: "zl", discordChannelId: "chan-pit" })],
    rooms: [],
    config: {},
    guildId: "guild-1",
  });
  assert.equal(byKind(targets, "zone-category").length, 1, "only the group's category");
  assert.equal(byKind(targets, "zone-summary").length, 0);
  assert.equal(byKind(targets, "zone-gm-role").map((t) => t.label).join(), "GM: Underground");
  // The level's Location channel parents onto the GROUP's category.
  const chan = byKind(targets, "location-channel")[0];
  assert.equal(chan.parentKey, "category:zone:zg");
  assert.equal(chan.parentId, "cat-u");
  // ...offset by the level, so the levels read in map order rather than clumped.
  assert.equal(chan.position, 1 * 10 + 0);
});

test("a Location channel is named after its slug and topiced with its description", () => {
  const chan = byKind(build(), "location-channel")[0];
  assert.equal(chan.name, "square");
  assert.equal(chan.properties.topic, "A wide stone square.");
  // A surface zone's #summary takes slot 0, so its Locations start at 1.
  assert.equal(chan.position, 1);
});

test("the two radio nets and Deadchat are described, with their categories", () => {
  const targets = build();
  assert.equal(byKind(targets, "special-category").length, 1);
  assert.ok(byKind(targets, "special-channel").length >= 2);
  assert.equal(byKind(targets, "deadchat-category").length, 1);
  assert.equal(byKind(targets, "deadchat-channel").length, 1);
  // Deliberately NO spectator seat on Deadchat: it would be the death list at
  // a glance, which is the leak the room was rebuilt to close.
  const dead = byKind(targets, "deadchat-channel")[0];
  const { SPECTATOR_ROLE_ID } = require("../lib/roleIds");
  assert.ok(!dead.overwrites.some((o) => o.id === SPECTATOR_ROLE_ID));
});

test("a Room thread carries the same hash syncRoomThread composes", () => {
  const { hashBody } = require("../lib/syncZones/shared");
  const { buildRoomBody } = require("../lib/syncZones/bodies");
  const components = [{ type: 1, components: [] }];
  const targets = build({ componentsByRoomId: new Map([["r1", components]]) });
  const thread = byKind(targets, "room-thread")[0];
  assert.equal(thread.bodyHash, hashBody(buildRoomBody(room(), null) + JSON.stringify(components)));
  assert.equal(thread.name, "The Well");
  assert.equal(thread.parentKey, "channel:location:l1");
});

test("every target says which column holds its id", () => {
  for (const t of build()) {
    if (t.targetType === "anchor") continue;
    assert.ok(t.idColumn?.model && t.idColumn.field, `${t.kind} has no id column`);
  }
});

test("roles are ordered ahead of every channel, and channels ahead of threads", () => {
  const targets = build();
  const maxRole = Math.max(...targets.filter((t) => t.targetType === "role").map((t) => t.order));
  const minChannel = Math.min(...targets.filter((t) => t.targetType === "channel").map((t) => t.order));
  const minThread = Math.min(...targets.filter((t) => t.targetType === "thread").map((t) => t.order));
  assert.ok(maxRole < minChannel);
  assert.ok(minChannel < minThread);
});
