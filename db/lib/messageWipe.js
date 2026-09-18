// The message wipe: called from db/index.js#advanceTurn() on EVERY turn while
// GameConfig.messageWipeEnabled is on. TWO CADENCES:
//   every turn — a Location channel down to its pinned anchor, every Room
//                thread down to its starter, every Conversation deleted
//                outright, and every special channel marked `wipe: "clear"`.
//   once a day — a zone's #summary, the abstracted slowmoded channel
//                adjudication results land in.
// Every rule is bounded by a CUTOFF (when the turn advance's side effects
// began), so it can't eat its own push's #summary post or an in-flight
// message. Sequential, not Promise.all, to respect Discord's rate limits.
const { SPECIAL_CHANNELS } = require("./specialChannels");
const {
  fetchAllMessages,
  bulkDeleteMessages,
  clearMessagesExcept,
  listActiveThreadsForChannel,
  fetchActiveThreads,
  getChannel,
  patchThread,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  snowflakeForTimestamp,
  messageTimestamp,
  beginRequestMetrics,
  readRequestMetrics,
} = require("./discordRest");

// One instant, two ways: `before` is the synthetic snowflake for Discord's
// message cursor; `ms` is the same moment for thread ids we judge ourselves.
function buildCutoff(cutoffMs) {
  return { ms: cutoffMs, before: snowflakeForTimestamp(cutoffMs) };
}

// An id we can't parse is treated as old — stays under ordinary rules
// rather than silently becoming immortal.
function isAfterCutoff(snowflakeId, cutoff) {
  const at = messageTimestamp(snowflakeId);
  return at !== null && at >= cutoff.ms;
}

async function clearMessages(channelOrThreadId, before) {
  const messages = await fetchAllMessages(channelOrThreadId, { before });
  if (messages.length === 0) return;
  await bulkDeleteMessages(
    channelOrThreadId,
    messages.map((m) => m.id),
  );
}

async function collectThreads(channelId, activeSnapshot) {
  const active = await listActiveThreadsForChannel(channelId, activeSnapshot);
  const archivedPublic = await listArchivedPublicThreads(channelId);
  const archivedPrivate = await listArchivedPrivateThreads(channelId);

  const byId = new Map();
  for (const thread of [...active, ...archivedPublic, ...archivedPrivate]) byId.set(thread.id, thread);
  return [...byId.values()];
}

// Adopt a thread the DB doesn't know: write the row instead of deleting it,
// so it survives one turn and then lives under the ordinary rules.
async function adoptThread(prisma, thread, location) {
  return prisma.playerThread
    .create({
      data: {
        threadId: thread.id,
        name: thread.name ?? "thread",
        locationId: location.id,
      },
    })
    .catch((err) => {
      console.error(`Message wipe: couldn't adopt thread ${thread.id}:`, err.message);
      return null;
    });
}

async function deletePlayerThread(prisma, threadId) {
  await deleteThread(threadId);
  await prisma.playerThread.deleteMany({ where: { threadId } }).catch(() => {});
  await prisma.playerThreadInvite.deleteMany({ where: { threadId } }).catch(() => {});
}

async function wipeLocation(prisma, location, roomsByThreadId, rowsByThreadId, activeSnapshot, cutoff) {
  if (!location.discordChannelId) return;

  // allow404: a channel deleted by hand is ordinary for a blind sweep.
  const channel = await getChannel(location.discordChannelId, { allow404: true });
  if (!channel) return;

  await clearMessagesExcept(location.discordChannelId, location.anchorMessageId, { before: cutoff.before });

  const threads = await collectThreads(location.discordChannelId, activeSnapshot);
  for (const thread of threads) {
    const room = roomsByThreadId.get(thread.id);
    if (room) {
      await clearMessagesExcept(thread.id, room.starterMessageId, { before: cutoff.before });
      // An idled-into-archive room comes back at the wipe.
      if (thread.thread_metadata?.archived) {
        await patchThread(thread.id, { archived: false }).catch((err) =>
          console.error(`Message wipe: unarchive of room ${room.name} failed:`, err.message),
        );
      }
      continue;
    }

    // A thread younger than the cutoff was opened mid-wipe — leave it, its
    // author may still be looking at it; ordinary rules apply next turn.
    if (isAfterCutoff(thread.id, cutoff)) continue;

    let row = rowsByThreadId.get(thread.id);
    if (!row) {
      row = await adoptThread(prisma, thread, location);
      continue;
    }
    await deletePlayerThread(prisma, thread.id);
  }
}

// `cutoffMs` is when the turn advance's side effects began (see
// db/index.js#runSideEffects); defaults to "now" so a hand-run wipe can't eat
// its own tail. `wipeSummaries` is the slower half, true only on the turn that starts a new game-day.
async function runMessageWipe(prisma, { cutoffMs = Date.now(), wipeSummaries = false } = {}) {
  const startedAt = Date.now();
  const cutoff = buildCutoff(cutoffMs);
  const steps = [];

  const [zones, config, rooms, playerThreads] = await Promise.all([
    prisma.zone.findMany({
      where: { kind: { not: "CAVE_GROUP" } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { locations: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.room.findMany({ where: { discordThreadId: { not: null } } }),
    prisma.playerThread.findMany(),
  ]);
  const roomsByThreadId = new Map(rooms.map((r) => [r.discordThreadId, r]));
  const rowsByThreadId = new Map(playerThreads.map((row) => [row.threadId, row]));

  // Fetched ONCE for the whole wipe — the endpoint is guild-wide.
  const activeThreads = await fetchActiveThreads().catch((err) => {
    console.error("Message wipe: active-thread snapshot failed, falling back to per-channel fetches:", err);
    return null;
  });

  const failures = [];

  // Each step is timed and counted, landing in the SystemReport below, so the
  // Dev Panel can answer which part of the wipe was slow.
  const timeStep = async (name, fn) => {
    const at = Date.now();
    const metrics = beginRequestMetrics();
    let ok = true;
    try {
      await fn();
    } catch (err) {
      ok = false;
      throw err;
    } finally {
      steps.push({ name, ok, elapsedMs: Date.now() - at, ...readRequestMetrics(metrics) });
    }
  };

  let locationCount = 0;
  for (const zone of zones) {
    console.log(`Message wipe: ${zone.name}`);
    // The one Dawn-only target; the zone loop still runs every turn for the
    // Locations underneath it.
    if (wipeSummaries && zone.discordSummaryChannelId) {
      try {
        await timeStep(`${zone.name} / summary`, () => clearMessages(zone.discordSummaryChannelId, cutoff.before));
      } catch (err) {
        failures.push({ step: "summary", target: zone.name, message: err.message });
        console.error(`Message wipe: ${zone.name} #summary failed, continuing:`, err.message);
      }
    }
    // Own try per location, so one stale channel id costs one room.
    for (const location of zone.locations) {
      locationCount += 1;
      try {
        await timeStep(`${zone.name} / ${location.name}`, () =>
          wipeLocation(prisma, location, roomsByThreadId, rowsByThreadId, activeThreads, cutoff),
        );
      } catch (err) {
        failures.push({ step: "location", target: `${zone.name} / ${location.name}`, message: err.message });
        console.error(`Message wipe: ${location.name} failed, continuing with the rest:`, err.message);
      }
    }
  }

  for (const entry of SPECIAL_CHANNELS) {
    if (entry.wipe !== "clear") continue;
    const channelId = config?.[entry.configKey];
    if (!channelId) continue;
    console.log(`Message wipe: #${entry.slug}`);
    try {
      await timeStep(`#${entry.slug}`, () => clearMessages(channelId, cutoff.before));
    } catch (err) {
      failures.push({ step: "special", target: entry.slug, message: err.message });
      console.error(`Message wipe: #${entry.slug} failed:`, err.message);
    }
  }

  if (failures.length > 0) {
    console.error(`Message wipe finished with ${failures.length} failures.`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `Message wipe finished in ${Math.round(elapsedMs / 1000)}s over ` +
      `${steps.reduce((n, step) => n + step.requests, 0)} Discord requests.`,
  );

  await prisma.systemReport
    .create({
      data: {
        kind: "DAWN_WIPE",
        startedAt: new Date(startedAt),
        finishedAt: new Date(),
        ok: failures.length === 0,
        summary: {
          summaries: wipeSummaries,
          zones: zones.length,
          locations: locationCount,
          elapsedMs,
          requests: steps.reduce((n, step) => n + step.requests, 0),
          sleepMs: steps.reduce((n, step) => n + step.sleepMs, 0),
          retries: steps.reduce((n, step) => n + step.retries, 0),
          cutoff: new Date(cutoff.ms).toISOString(),
          steps,
        },
        failures,
      },
    })
    .catch((err) => console.error("Message wipe: report write failed:", err.message));

  return { failed: failures.length, failures };
}

module.exports = { runMessageWipe };
