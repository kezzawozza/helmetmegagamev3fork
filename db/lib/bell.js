// The Cathedral bell — a rope in the Bell Tower (docs/zones.yaml). Carries across the Location graph
// like /shout, through db/lib/soundBroadcast.js. The intercom's quiet cousin: does NOT carry @here —
// a bell is simply audible. Takes `prisma`, off the @lifeweb/db barrel (db/lib/dm.js convention).
const { broadcastSound } = require("./soundBroadcast");

// The Cathedral's Bell Tower, hardcoded for the db/lib/roleIds.js reason.
const BELL_ROOM_SLUG = "cathedral-bell-tower";

// How far the peal reaches, in hops, and how far it stays full size — further than /shout's four,
// out to the edges of the Marshes and Black Hills. The underground hears nothing (soundBroadcast decides).
const BELL_HOPS = 7;
const BELL_LOUD_HOPS = 4;

// Thirty minutes: long enough nobody pours it into noise, short enough to stay usable as a signal.
// Hardcoded, not a GameConfig knob — one rope, one right answer.
const BELL_COOLDOWN_MS = 30 * 60 * 1000;

// One line, whatever the distance — a bell never muffles (soundBroadcast.js).
const BELL_LINE = "You hear a church bell ringing.";

// What somebody types to pull the rope — a speed bump, not a password (case/spaces forgiven).
const RING_WORD = "RING";

function bellWordMatches(typed) {
  return String(typed ?? "").trim().toUpperCase() === RING_WORD;
}

// Null until somebody has rung it. Returns { ok } or { ok: false, secondsLeft }
// so the caller can say how long the rope has left to hang still.
function bellCooldown(bellRungAt, now = Date.now()) {
  if (!bellRungAt) return { ok: true, secondsLeft: 0 };
  const elapsed = now - new Date(bellRungAt).getTime();
  if (elapsed >= BELL_COOLDOWN_MS) return { ok: true, secondsLeft: 0 };
  return { ok: false, secondsLeft: Math.ceil((BELL_COOLDOWN_MS - elapsed) / 1000) };
}

// The rope is in a Room, but sound comes from the Location that Room is in.
async function broadcastBell(prisma) {
  const tower = await prisma.room.findUnique({
    where: { slug: BELL_ROOM_SLUG },
    select: { locationId: true },
  });
  if (!tower?.locationId) return { sent: 0, failed: [] };

  return broadcastSound(prisma, {
    originLocationId: tower.locationId,
    text: BELL_LINE,
    maxHops: BELL_HOPS,
    loudHops: BELL_LOUD_HOPS,
  });
}

module.exports = {
  BELL_ROOM_SLUG,
  BELL_HOPS,
  BELL_LOUD_HOPS,
  BELL_COOLDOWN_MS,
  RING_WORD,
  bellWordMatches,
  bellCooldown,
  broadcastBell,
};
