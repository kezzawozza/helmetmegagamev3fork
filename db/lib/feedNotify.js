// The pub/sub half of the live feed: one Postgres NOTIFY per archived row, on `bascinet_feed`. The
// web's SSE hub (web/lib/feedHub.js) fans it out; the bot's outbox (bot/src/lib/feedOutbox.js) picks
// up WEB rows to post to Discord. Payload is deliberately tiny — NOTIFY has an 8000-byte ceiling and a
// listener re-checks who may see the row rather than trusting the payload. Best-effort: a failed
// notify costs a browser its instant update; the next reconnect catches up from its cursor.

const FEED_CHANNEL = "bascinet_feed";

// `op`: "new" (default), "edit" or "delete" — the listener still loads and re-checks who may see it.
// `clientId` is the composer's optimistic-copy token: the stream is usually quicker than the send's
// own answer, so without it the sending tab would meet its own message as a stranger (second row,
// second React key) until the POST returns. Browser-supplied, trusted only for matching.
async function notifyFeed(prisma, { seq, placeKey, op = "new", clientId = null } = {}) {
  if (seq === null || seq === undefined || !placeKey) return false;
  try {
    // seq is a BigInt; goes over the wire as a string, parsed back with BigInt(), never Number().
    const payload = JSON.stringify({
      seq: String(seq),
      placeKey,
      op,
      // Clamped: this half of the payload came off a request body.
      ...(typeof clientId === "string" && clientId ? { clientId: clientId.slice(0, 64) } : {}),
    });
    await prisma.$executeRaw`SELECT pg_notify(${FEED_CHANNEL}, ${payload})`;
    return true;
  } catch (err) {
    console.error("Feed notify failed:", err);
    return false;
  }
}

module.exports = { notifyFeed, FEED_CHANNEL };
