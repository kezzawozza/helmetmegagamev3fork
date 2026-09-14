const test = require("node:test");
const assert = require("node:assert/strict");

const { runLocationOccupancySweep } = require("../lib/channelDoctor/sweeps/locationOccupancy");
const {
  LOCATION_MEMBER_ALLOW,
  LOCATION_VANTAGE_ALLOW,
  LOCATION_VANTAGE_DENY,
} = require("../lib/zoneChannelSpec");

// A prisma stand-in with just what allVantages() reads: the open turn and the
// Vantage rows. Nothing here reaches a database or Discord — the sweep's
// repairs are closures handed to `report`, and the test never calls them.
function fakePrisma(vantages) {
  return {
    turn: { findFirst: async () => ({ id: "t1" }) },
    vantage: { findMany: async () => vantages },
  };
}

const location = { id: "loc", zoneName: "Town", name: "Square", discordChannelId: "chan" };
const stander = { id: "c1", discordUserId: "u1", locationId: "loc", zoneId: "z", webOnly: false };
const watcher = { id: "c2", discordUserId: "u2", locationId: "elsewhere", zoneId: "z", webOnly: false };
const vantageRow = { characterId: "c2", locationId: "loc", zoneId: "z", turnId: "t1" };

async function sweep(overwrites) {
  const reports = [];
  await runLocationOccupancySweep({
    report: async (check, label, why) => reports.push(why),
    prisma: fakePrisma([vantageRow]),
    locations: [location],
    liveLocationChannels: new Map([["loc", { permission_overwrites: overwrites }]]),
    alive: [stander, watcher],
  });
  return reports;
}

const member = (id, allow, deny = 0n) => ({ id, type: 1, allow: String(allow), deny: String(deny) });

test("a watcher holding the view with no deny is flagged", async () => {
  const reports = await sweep([
    member("u1", LOCATION_MEMBER_ALLOW),
    member("u2", LOCATION_VANTAGE_ALLOW),
  ]);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /u2 holds the wrong permissions/);
});

test("correct standing and watching overwrites pass clean", async () => {
  const reports = await sweep([
    member("u1", LOCATION_MEMBER_ALLOW),
    member("u2", LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY),
  ]);
  assert.deepEqual(reports, []);
});

test("a stander carrying the watcher's deny is flagged", async () => {
  const reports = await sweep([
    member("u1", LOCATION_MEMBER_ALLOW, LOCATION_VANTAGE_DENY),
    member("u2", LOCATION_VANTAGE_ALLOW, LOCATION_VANTAGE_DENY),
  ]);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /u1 holds the wrong permissions/);
});
