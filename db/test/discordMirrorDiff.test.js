// diff.js — desired x live x the ids the database records, turned into ops.
//
// The four things worth pinning down, and all four are about not making a mess
// of somebody's live guild:
//   - a world that already matches produces NOTHING. If a routine run proposes
//     work, the run is the bug.
//   - a null id with a matching channel already in Discord is ADOPTED, not
//     re-created. This is what makes the reconciler safe to kill halfway.
//   - two matching channels is nobody's guess to make: a finding, no create.
//   - a missing role is created before any channel that would grant to it.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DISCORD_GUILD_ID ||= "guild-1";

const { buildDesired } = require("../lib/discordMirror/desired");
const { buildOps } = require("../lib/discordMirror/diff");
const { emptySnapshot, channelKey, threadKey } = require("../lib/discordMirror/live");

// --- fixture rows ------------------------------------------------------

const baseZone = {
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
const baseLocation = {
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
const baseRoom = {
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
};
const baseConfig = {
  radioCategoryId: "cat-radio",
  cerberonChannelId: "chan-cerberon",
  freq27065ChannelId: "chan-27065",
  deadchatCategoryId: "cat-dead",
  deadchatChannelId: "chan-dead",
};

// Builds desired twice: once to learn the hashes a matching world would carry,
// then again with those hashes on the rows. That is what "already provisioned"
// means for a room starter and a pinned anchor — the row remembers what it last
// posted.
function provisioned(over = {}) {
  const rows = {
    zones: [{ ...baseZone }],
    locations: [{ ...baseLocation }],
    rooms: [{ ...baseRoom }],
    config: { ...baseConfig },
    spectators: true,
    guildId: "guild-1",
    ...over,
  };
  const first = buildDesired(rows);
  const hashes = new Map(first.map((t) => [t.key, t.bodyHash]));
  rows.rooms = rows.rooms.map((r) => ({ ...r, postHash: hashes.get(`thread:room:${r.id}`) ?? null }));
  rows.locations = rows.locations.map((l) => ({
    ...l,
    anchorHash: hashes.get(`anchor:location:${l.id}`) ?? null,
  }));
  return { rows, desired: buildDesired(rows) };
}

// A live snapshot that agrees with every desired target: same ids, same names,
// same parents, same positions, same topics, same overwrites.
function liveFrom(desired, { drop = [], duplicate = [] } = {}) {
  const snapshot = emptySnapshot();
  const idByKey = new Map(desired.map((t) => [t.key, t.currentId]));
  const push = (map, key, value) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(value);
    else map.set(key, [value]);
  };

  for (const t of desired) {
    if (drop.includes(t.key)) continue;
    const id = idByKey.get(t.key);
    if (!id) continue;

    if (t.targetType === "role") {
      const role = { id, name: t.name };
      snapshot.rolesById.set(id, role);
      push(snapshot.rolesByName, t.name, role);
    } else if (t.targetType === "channel") {
      const parentId = t.parentKey ? idByKey.get(t.parentKey) ?? null : null;
      const channel = {
        id,
        name: t.name,
        type: t.discordType,
        parent_id: parentId,
        position: t.position ?? 0,
        topic: t.properties?.topic ?? null,
        rate_limit_per_user: t.properties?.rate_limit_per_user ?? 0,
        permission_overwrites: (t.overwrites ?? []).map((o) => ({
          id: o.id,
          type: o.type,
          allow: String(o.allow ?? "0"),
          deny: String(o.deny ?? "0"),
        })),
      };
      snapshot.channelsById.set(id, channel);
      push(snapshot.channelsByKey, channelKey(t.discordType, parentId, t.name), channel);
      for (const copy of duplicate.filter((d) => d === t.key)) {
        void copy;
        const twin = { ...channel, id: `${id}-twin` };
        push(snapshot.channelsByKey, channelKey(t.discordType, parentId, t.name), twin);
        snapshot.channelsById.set(twin.id, twin);
      }
    } else if (t.targetType === "thread") {
      const parentId = t.parentKey ? idByKey.get(t.parentKey) ?? null : null;
      const thread = { id, name: t.name, parent_id: parentId };
      snapshot.threadsById.set(id, thread);
      push(snapshot.threadsByKey, threadKey(parentId, t.name), thread);
    }
  }
  return snapshot;
}

// --- the tests ---------------------------------------------------------

test("a world that already matches produces no ops at all", () => {
  const { desired } = provisioned();
  const { ops, findings } = buildOps({ desired, live: liveFrom(desired), prisma: null });
  assert.deepEqual(
    ops.map((o) => `${o.kind}:${o.targetId}`),
    [],
  );
  assert.deepEqual(findings, []);
});

test("a null channel id with a matching live channel is adopted, not created", () => {
  const { desired } = provisioned();
  const live = liveFrom(desired);
  // Forget the id the way a crash between the Discord POST and the database
  // UPDATE would. The channel is still sitting there in the guild.
  const target = desired.find((t) => t.key === "channel:location:l1");
  const liveId = target.currentId;
  target.currentId = null;

  const { ops, findings } = buildOps({ desired, live, prisma: null });
  const mine = ops.filter((o) => o.targetId === "channel:location:l1");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, "adopt");
  assert.ok(mine[0].reason.includes(liveId));
  assert.equal(ops.filter((o) => o.kind === "create").length, 0);
  assert.deepEqual(findings, []);
});

test("two live channels of the same name: a finding, and nothing is created", () => {
  const { desired } = provisioned();
  const live = liveFrom(desired, { duplicate: ["channel:location:l1"] });
  desired.find((t) => t.key === "channel:location:l1").currentId = null;

  const { ops, findings } = buildOps({ desired, live, prisma: null });
  assert.equal(ops.filter((o) => o.targetId === "channel:location:l1").length, 0);
  const ambiguous = findings.filter((f) => f.check === "mirror-ambiguous");
  assert.equal(ambiguous.length, 1);
  assert.match(ambiguous[0].problem, /2 channels/);
});

test("a missing zone role is created, and ordered ahead of every channel op", () => {
  const { desired } = provisioned();
  const live = liveFrom(desired);
  // Null the column AND take the role out of the guild, so there is nothing to
  // adopt. Also null a channel, so there is a channel op to be ordered against.
  desired.find((t) => t.key === "role:zone:z1").currentId = null;
  live.rolesByName.delete("Zone: Town");
  desired.find((t) => t.key === "channel:summary:z1").currentId = null;
  live.channelsByKey.clear();

  const { ops } = buildOps({ desired, live, prisma: null });
  const roleOps = ops.filter((o) => o.targetType === "role");
  assert.equal(roleOps.length, 1);
  assert.equal(roleOps[0].kind, "create");
  const channelOps = ops.filter((o) => o.targetType === "channel");
  assert.ok(channelOps.length > 0);
  assert.ok(roleOps[0].order < Math.min(...channelOps.map((o) => o.order)));
  // ...and the list itself is handed back in that order.
  assert.deepEqual(
    ops.map((o) => o.order),
    [...ops.map((o) => o.order)].sort((a, b) => a - b),
  );
});

test("a recorded id pointing at nothing is reported and then re-adopted by name", () => {
  const { desired } = provisioned();
  const live = liveFrom(desired);
  desired.find((t) => t.key === "channel:location:l1").currentId = "chan-gone";

  const { ops, findings } = buildOps({ desired, live, prisma: null });
  assert.ok(findings.some((f) => f.check === "mirror-missing"));
  const mine = ops.filter((o) => o.targetId === "channel:location:l1");
  assert.equal(mine[0].kind, "adopt");
});

test("a role id already spent on another zone's @unique column is reported, not thrown at", () => {
  const { rows } = provisioned();
  // Two zones whose access roles would adopt the same live role.
  const twin = { ...baseZone, id: "z2", slug: "twin", name: "Town", discordRoleId: null, gmRoleId: "role-gm2", discordCategoryId: "cat-2", discordSummaryChannelId: "sum-2" };
  const desired = buildDesired({ ...rows, zones: [rows.zones[0], twin] });
  const live = liveFrom(desired);

  const { ops, findings } = buildOps({ desired, live, prisma: null });
  assert.ok(findings.some((f) => f.check === "mirror-collision"));
  assert.equal(ops.filter((o) => o.targetId === "role:zone:z2").length, 0);
});

test("a drifted topic is one patch op, ordered after the creates", () => {
  const { desired } = provisioned();
  const live = liveFrom(desired);
  live.channelsById.get("chan-1").topic = "something a GM typed by hand";

  const { ops } = buildOps({ desired, live, prisma: null });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "patch");
  assert.match(ops[0].reason, /topic/);
});

test("a recorded thread absent from the active-thread snapshot is a finding, never a duplicate", () => {
  const { desired } = provisioned();
  // Dropped from the snapshot entirely — an archived thread, invisible to
  // fetchActiveThreads, looks exactly like this.
  const live = liveFrom(desired, { drop: ["thread:room:r1"] });

  const { ops, findings } = buildOps({ desired, live, prisma: null });
  assert.equal(ops.filter((o) => o.targetId === "thread:room:r1").length, 0);
  const missing = findings.filter((f) => f.check === "mirror-missing");
  assert.equal(missing.length, 1);
  assert.match(missing[0].problem, /may just be archived/);
});

test("the radio channel's name never drifts on the dot Discord may have stripped", () => {
  for (const storedName of ["27.065", "27065"]) {
    const { desired } = provisioned();
    const live = liveFrom(desired);
    const target = desired.find((t) => t.key === "channel:special:27.065");
    // Whether Discord kept the punctuation or stripped it, this is the same
    // channel — comparing raw strings here would PATCH the name back to
    // itself forever.
    live.channelsById.get(target.currentId).name = storedName;

    const { ops } = buildOps({ desired, live, prisma: null });
    assert.deepEqual(
      ops.filter((o) => o.targetId === "channel:special:27.065"),
      [],
      `stored as "${storedName}"`,
    );
  }
});

test("the per-member sweeps are not ops — they run beside the op list", () => {
  const { desired } = provisioned();
  const live = liveFrom(desired);
  // A world that matches produces nothing at any scope. The sweeps that
  // reconcile who holds which role are sweeps.js's, not entries here: two
  // detectors for one fault is one too many.
  assert.equal(buildOps({ desired, live, prisma: null, scope: "structure" }).ops.length, 0);
  assert.equal(buildOps({ desired, live, prisma: null, scope: "full" }).ops.length, 0);
});
