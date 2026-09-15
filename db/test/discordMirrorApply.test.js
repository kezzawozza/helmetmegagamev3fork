// apply.js with the writes turned on — and the one property the whole design
// rests on: a second run does nothing.
//
// That is what makes the mirror safe to put on the bot's restart, the end of
// every turn, and a queue drain. If a routine pass proposed work, it would be
// rewriting the same channels forever and nobody would notice until Discord
// started refusing calls. So the test drives a real cycle: null one Location's
// channel id, apply, and check that exactly one channel was created and the id
// written back — then rebuild the picture from the rows the apply left behind
// and check that the second pass has nothing to do and sends nothing.
//
// Discord is faked at the seam the run thunks use. diff.js requires
// db/lib/discordRest INSIDE each thunk rather than at the top of the file, so
// swapping a function on that module's exports is enough; nothing here touches
// the network, and `prisma` is an object with the three writers the ops call.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.DISCORD_GUILD_ID ||= "guild-1";

const rest = require("../lib/discordRest");
const { buildDesired } = require("../lib/discordMirror/desired");
const { buildOps } = require("../lib/discordMirror/diff");
const { applyOps } = require("../lib/discordMirror/apply");
const { snapshotFromDesired } = require("../lib/discordMirror/live");

// --- the fakes ---------------------------------------------------------

function fakeDiscord() {
  const calls = [];
  const original = {};
  let seq = 0;
  const stub = (name, answer) => {
    original[name] = rest[name];
    rest[name] = async (...args) => {
      calls.push({ name, args });
      seq += 1;
      return answer(seq, ...args);
    };
  };
  stub("createChannel", (n) => ({ id: `new-channel-${n}` }));
  stub("createGuildRole", (n) => ({ id: `new-role-${n}` }));
  stub("patchChannel", () => ({}));
  stub("patchGuildChannelPositions", () => ({}));
  stub("putChannelOverwrite", () => ({}));
  stub("deleteChannelOverwrite", () => ({}));
  stub("getChannel", () => null);
  return {
    calls,
    restore() {
      for (const [name, fn] of Object.entries(original)) rest[name] = fn;
    },
  };
}

// Just enough Prisma for the id write-backs the ops do. Every update lands on
// the row object the desired state was built from, which is exactly what the
// real client's update plus the next run's re-read amounts to.
function fakePrisma(rows) {
  const writes = [];
  const model = (list) => ({
    async update({ where, data }) {
      const row = list.find((r) => String(r.id) === String(where.id));
      assert.ok(row, `no such row ${where.id}`);
      Object.assign(row, data);
      writes.push({ id: where.id, data });
      return row;
    },
  });
  return {
    writes,
    zone: model(rows.zones),
    location: model(rows.locations),
    room: model(rows.rooms),
    gameConfig: model([rows.config]),
  };
}

// The whole-`runDiscordMirror` test below walks through loadRows() and every
// sweep's own queries, not just the three tables the ops write. Rather than
// hand-list every model runSweeps touches, anything not named explicitly here
// answers like an empty table — which is what a fresh local database actually
// looks like for locationLink, tag, action, note and the rest this test never
// populates.
function fakeFullPrisma(rows) {
  const richModel = (list) => ({
    async findMany() {
      return list;
    },
    async findUnique({ where } = {}) {
      return list.find((r) => String(r.id) === String(where?.id)) ?? null;
    },
    async update({ where, data }) {
      const row = list.find((r) => String(r.id) === String(where.id));
      assert.ok(row, `no such row ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    async upsert({ where, update, create }) {
      const row = list.find((r) => String(r.id) === String(where.id));
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { id: where.id, ...create };
      list.push(created);
      return created;
    },
    async count() {
      return 0;
    },
  });
  const genericModel = () => ({
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    upsert: async ({ create } = {}) => ({ ...create }),
    update: async ({ data } = {}) => ({ ...data }),
    create: async ({ data } = {}) => ({ ...data }),
  });
  const known = {
    zone: richModel(rows.zones),
    location: richModel(rows.locations),
    room: richModel(rows.rooms),
    gameConfig: richModel([rows.config]),
    character: richModel(rows.characters ?? []),
    gameState: richModel([rows.gameState ?? { id: 1, phase: "RUNNING" }]),
  };
  return new Proxy(known, {
    get(target, prop) {
      return prop in target ? target[prop] : genericModel();
    },
  });
}

// --- the world ---------------------------------------------------------

const ZONE = {
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
};
const LOCATION = {
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
};
const CONFIG = {
  id: 1,
  radioCategoryId: "cat-radio",
  cerberonChannelId: "chan-cerberon",
  freq27065ChannelId: "chan-27065",
  deadchatCategoryId: "cat-dead",
  deadchatChannelId: "chan-dead",
};
const CHARACTER = {
  id: "c1",
  name: "Ada",
  discordUserId: "user-1",
  status: "ALIVE",
  buriedAt: null,
  cursedOverride: null,
  createdAt: new Date(),
  discordRoleId: "role-char1",
  zoneId: "z1",
  locationId: "l1",
  turnPingOptIn: false,
  discordMirrored: true,
};

// No rooms: a room's thread is syncRoomThread's job, and that needs a real
// thread to rewrite. The channel underneath it is what this test is about.
function world() {
  const rows = { zones: [{ ...ZONE }], locations: [{ ...LOCATION }], rooms: [], config: { ...CONFIG } };
  const build = () => {
    const desired = buildDesired({ ...rows, spectators: true, guildId: "guild-1" });
    // The anchor remembers what it last posted, so a settled world proposes no
    // rewrite of it.
    for (const target of desired) {
      if (target.targetType === "anchor") {
        const row = rows.locations.find((l) => l.id === target.subject.id);
        if (row && row.anchorHash === null) row.anchorHash = target.bodyHash;
      }
    }
    return buildDesired({ ...rows, spectators: true, guildId: "guild-1" });
  };
  return { rows, build };
}

// --- the test ----------------------------------------------------------

test("a settled world proposes nothing, and sends nothing", async () => {
  const discord = fakeDiscord();
  try {
    const { rows, build } = world();
    const desired = build();
    const { ops } = buildOps({ desired, live: snapshotFromDesired(desired), prisma: fakePrisma(rows) });
    assert.deepEqual(ops, []);
    const { failures } = await applyOps(ops, { apply: true });
    assert.deepEqual(failures, []);
    assert.equal(discord.calls.length, 0);
  } finally {
    discord.restore();
  }
});

test("a Location that has lost its channel gets exactly one back, and only once", async () => {
  const discord = fakeDiscord();
  try {
    const { rows, build } = world();
    build(); // settle the anchor hash first
    rows.locations[0].discordChannelId = null;

    // --- first pass: one create, and the id lands on the row ---
    const desired = build();
    const prisma = fakePrisma(rows);
    const first = buildOps({ desired, live: snapshotFromDesired(desired), prisma });
    assert.deepEqual(
      first.ops.map((o) => `${o.kind}:${o.targetId}`),
      ["create:channel:location:l1"],
    );

    const ran = await applyOps(first.ops, { apply: true });
    assert.deepEqual(ran.failures, []);
    assert.equal(ran.ran.every((r) => r.status === "ran"), true);

    const creates = discord.calls.filter((c) => c.name === "createChannel");
    assert.equal(creates.length, 1);
    assert.equal(creates[0].args[0].parent_id, "cat-1");
    assert.equal(rows.locations[0].discordChannelId, "new-channel-1");
    assert.deepEqual(prisma.writes, [{ id: "l1", data: { discordChannelId: "new-channel-1" } }]);

    // --- second pass: nothing at all ---
    const callsBefore = discord.calls.length;
    const again = build();
    const second = buildOps({ desired: again, live: snapshotFromDesired(again), prisma });
    assert.deepEqual(second.ops, [], "a second run must propose no work");
    assert.deepEqual(second.findings, []);
    await applyOps(second.ops, { apply: true });
    assert.equal(discord.calls.length, callsBefore, "a second run must send nothing");
  } finally {
    discord.restore();
  }
});

test("an op that throws is recorded, and the ops behind it still run", async () => {
  const discord = fakeDiscord();
  try {
    const ops = [
      { order: 1, kind: "create", targetType: "role", targetId: "a", reason: "a", run: async () => {
        throw new Error("Discord said no");
      } },
      { order: 2, kind: "create", targetType: "role", targetId: "b", reason: "b", run: async () => {} },
    ];
    const result = await applyOps(ops, { apply: true });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /Discord said no/);
    assert.deepEqual(
      result.ran.map((r) => r.status),
      ["failed", "ran"],
    );
  } finally {
    discord.restore();
  }
});

// The bug this guards: sweeps.js reads `live.channelsById` to find the
// Location channel it is about to open for whoever stands there. That map is
// a snapshot taken BEFORE the ops above ran, so a channel the ops just
// created was never in it — the character standing there got no overwrite
// until the NEXT run noticed. index.js now re-takes the picture once, only
// when apply actually built something, so this run's own occupancy sweep
// already sees it.
//
// LOCAL_MODE, not fakeDiscord(): sweeps.js and live.js destructure
// getGuildRoles/listGuildMembers/getGuildChannels/fetchActiveThreads at their
// own module top, not inside a thunk the way diff.js and apply.js do, so a
// property swap on the already-cached db/lib/discordRest module never reaches
// them. LOCAL_MODE's gate lives one layer lower, inside discordRequest itself
// (db/lib/discordRest/core.js), so it works regardless of when any of that
// destructuring happened — the same reason a real local dev run gets it for
// free. Every write it makes lands in the gitignored local outbox log
// instead of the network, which is what this test reads back.
test("a rebuilt Location channel gets its occupant's overwrite in the same run", async () => {
  const savedLocalMode = process.env.LOCAL_MODE;
  process.env.LOCAL_MODE = "true";
  const outboxPath = path.resolve(__dirname, "..", "..", "local-discord-outbox.jsonl");
  let outboxStart = 0;
  try {
    outboxStart = fs.statSync(outboxPath).size;
  } catch {
    outboxStart = 0;
  }
  try {
    const { rows, build } = world();
    build(); // settle the anchor hash first
    rows.locations[0].discordChannelId = null;
    rows.zones[0].locations = rows.locations; // sweeps.js reads zones with `include: { locations }`
    rows.characters = [{ ...CHARACTER }];
    rows.gameState = { id: 1, phase: "RUNNING" };

    const { runDiscordMirror } = require("../lib/discordMirror");
    const result = await runDiscordMirror(fakeFullPrisma(rows), { apply: true, scope: "cheap" });

    const newChannelId = rows.locations[0].discordChannelId;
    assert.ok(newChannelId && newChannelId !== "chan-1", "the channel was rebuilt");

    const outboxTail = fs.readFileSync(outboxPath, "utf8").slice(outboxStart);
    const entries = outboxTail
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const wantPath = `/channels/${newChannelId}/permissions/${CHARACTER.discordUserId}`;
    const overwrite = entries.find((e) => e.method === "PUT" && e.path === wantPath);
    assert.ok(overwrite, "the occupancy sweep must open the just-created channel to its occupant, in THIS run");
    assert.ok(result.repaired >= 1, "a ran op counts as a repair");
  } finally {
    if (savedLocalMode === undefined) delete process.env.LOCAL_MODE;
    else process.env.LOCAL_MODE = savedLocalMode;
  }
});
