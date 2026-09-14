// The second NOTIFY channel of the live feed: "this character's places have changed." Carries only a character id — the listener re-runs db/lib/feedAccess.js#placesFor itself, which keeps a notification from being an authorisation. Best-effort, exactly like notifyFeed.

const PRESENCE_CHANNEL = "bascinet_presence";

async function notifyPresence(prisma, characterId) {
  if (!characterId) return false;
  try {
    const payload = JSON.stringify({ characterId });
    await prisma.$executeRaw`SELECT pg_notify(${PRESENCE_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Presence notify failed:", err);
    return false;
  }
}

module.exports = { notifyPresence, PRESENCE_CHANNEL };
