// wipeGameMessages (Restart Game's message-only wipe, LAUNCH.md §2) — the
// property that makes it safe now that the Discord mirror, not a wipe-and-
// resync, is the repair path: it never deletes a category, a channel or a
// role, and a zone Room keeps its thread (messages cleared, starter nulled
// for a repost) while a quest Room's thread and any thread matching no Room
// at all (a Conversation) are the only ones actually deleted.
//
// Discord is faked at the seam fullWipe.js's destructured import binds at
// require time, so the fakes are installed on the real discordRest module's
// exports BEFORE fullWipe.js is (re)required — see the setup below.
const test = require("node:test");
const assert = require("node:assert/strict");

const rest = require("../lib/discordRest");

function fakeDiscord({ threads = [] } = {}) {
  const calls = [];
  const original = {};
  const stub = (name, answer) => {
    original[name] = rest[name];
    rest[name] = async (...args) => {
      calls.push({ name, args });
      return typeof answer === "function" ? answer(...args) : answer;
    };
  };

  stub("getGuildChannels", () => [
    { id: "chan-archive", type: 0, name: "archive" },
    { id: "chan-turns", type: 0, name: "turns" },
  ]);
  stub("fetchAllMessages", () => []);
  stub("bulkDeleteMessages", () => {});
  stub("listActiveThreadsForChannel", (channelId) => threads.filter((t) => t.channelId === channelId));
  stub("listArchivedPublicThreads", () => []);
  stub("listArchivedPrivateThreads", () => []);
  stub("deleteThread", () => {});
  stub("deleteChannel", () => {});
  stub("deleteGuildRole", () => {});

  return {
    calls,
    restore() {
      for (const [name, fn] of Object.entries(original)) rest[name] = fn;
    },
  };
}

function fakePrisma({ rooms }) {
  const updateManyCalls = { location: [], room: [] };
  return {
    updateManyCalls,
    zone: {
      findMany: async () => [
        {
          id: "zone-1",
          discordSummaryChannelId: "chan-summary-1",
          locations: [{ id: "loc-1", discordChannelId: "chan-loc-1" }],
        },
      ],
    },
    room: {
      findMany: async () => rooms,
      updateMany: async (args) => {
        updateManyCalls.room.push(args);
        return { count: 0 };
      },
    },
    location: {
      updateMany: async (args) => {
        updateManyCalls.location.push(args);
        return { count: 0 };
      },
    },
  };
}

test("wipeGameMessages keeps a zone Room's thread and clears its messages", async () => {
  const fake = fakeDiscord({
    threads: [{ id: "thread-zone-room", channelId: "chan-loc-1", name: "The Hearth" }],
  });
  delete require.cache[require.resolve("../lib/fullWipe")];
  const { wipeGameMessages } = require("../lib/fullWipe");

  try {
    const prisma = fakePrisma({
      rooms: [{ id: "room-1", discordThreadId: "thread-zone-room", questId: null }],
    });

    await wipeGameMessages(prisma);

    // The thread's messages were cleared (fetchAllMessages/bulkDeleteMessages
    // ran against it), but it was never deleted.
    const bulkDeleteTargets = fake.calls.filter((c) => c.name === "fetchAllMessages").map((c) => c.args[0]);
    assert.ok(bulkDeleteTargets.includes("thread-zone-room"), "the zone room's thread had its messages read");
    assert.equal(fake.calls.filter((c) => c.name === "deleteThread").length, 0, "no thread was deleted");

    // Never a category, channel or role.
    assert.equal(fake.calls.filter((c) => c.name === "deleteChannel").length, 0);
    assert.equal(fake.calls.filter((c) => c.name === "deleteGuildRole").length, 0);

    // discordThreadId survives; only the starter is nulled for a repost.
    const roomUpdate = prisma.updateManyCalls.room.find((u) => u.where?.questId === null);
    assert.ok(roomUpdate, "zone rooms got a starter-nulling update");
    assert.equal(roomUpdate.data.starterMessageId, null);
    assert.equal(roomUpdate.data.postHash, null);
    assert.ok(!("discordThreadId" in roomUpdate.data), "discordThreadId is not touched for a kept zone room");
  } finally {
    fake.restore();
  }
});

test("wipeGameMessages deletes a quest Room's thread and unlinks it", async () => {
  const fake = fakeDiscord({
    threads: [{ id: "thread-quest-room", channelId: "chan-loc-1", name: "A Cave" }],
  });
  delete require.cache[require.resolve("../lib/fullWipe")];
  const { wipeGameMessages } = require("../lib/fullWipe");

  try {
    const prisma = fakePrisma({
      rooms: [{ id: "room-quest", discordThreadId: "thread-quest-room", questId: "quest-1" }],
    });

    await wipeGameMessages(prisma);

    assert.deepEqual(
      fake.calls.filter((c) => c.name === "deleteThread").map((c) => c.args[0]),
      ["thread-quest-room"],
    );
    assert.equal(fake.calls.filter((c) => c.name === "deleteChannel").length, 0);
    assert.equal(fake.calls.filter((c) => c.name === "deleteGuildRole").length, 0);

    const unlink = prisma.updateManyCalls.room.find((u) => u.where?.id?.in?.includes("room-quest"));
    assert.ok(unlink, "the quest room was unlinked so the mirror rebuilds it");
    assert.equal(unlink.data.discordThreadId, null);
    assert.equal(unlink.data.starterMessageId, null);
    assert.equal(unlink.data.postHash, null);
  } finally {
    fake.restore();
  }
});

test("wipeGameMessages deletes a thread matching no Room (a Conversation)", async () => {
  const fake = fakeDiscord({
    threads: [{ id: "thread-conversation", channelId: "chan-loc-1", name: "whispers" }],
  });
  delete require.cache[require.resolve("../lib/fullWipe")];
  const { wipeGameMessages } = require("../lib/fullWipe");

  try {
    const prisma = fakePrisma({ rooms: [] });

    await wipeGameMessages(prisma);

    assert.deepEqual(
      fake.calls.filter((c) => c.name === "deleteThread").map((c) => c.args[0]),
      ["thread-conversation"],
    );
    assert.equal(fake.calls.filter((c) => c.name === "deleteChannel").length, 0);
    assert.equal(fake.calls.filter((c) => c.name === "deleteGuildRole").length, 0);
  } finally {
    fake.restore();
  }
});
