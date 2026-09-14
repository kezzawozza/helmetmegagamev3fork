// The Cathedral bell. A rope in the Bell Tower, which is what docs/zones.yaml
// has always said is up there — "waiting for a tug from below to let it sound
// across the land."
//
// It carries across the Location graph, the way /shout does, through
// db/lib/soundBroadcast.js. It used to post into four hardcoded zone #summary
// channels instead, which was a list of channels pretending to be a rule about
// sound: it could not say that the Square hears the bell better than the far
// Marshes do, and it made the Black Hills deaf for no reason a player standing
// on them could work out.
//
// It is the intercom's quiet cousin. What it does NOT carry is the @here. The
// PA is addressed to you; a bell is simply audible, and pinging a hundred
// people every time a chaplain pulls a rope would have made it a nuisance
// rather than a signal.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { broadcastSound } = require("./soundBroadcast");

// The Cathedral's Bell Tower, hardcoded for the db/lib/roleIds.js reason: one
// guild, one correct value, and a missing env var would have been a silent
// no-op.
const BELL_ROOM_SLUG = "cathedral-bell-tower";

// How far the peal reaches, in hops, and how far it stays full size. A bell in
// a stone tower is not a man shouting, so it goes a good deal further than
// /shout's four — out to the edges of the Marshes and the Black Hills, where it
// arrives as subtext rather than as something in the conversation.
//
// Measured from the Cathedral this is 20 Locations loud and 16 quiet: all of
// Town and most of the Forest at full size, the Fortress split, the far edges
// faint. The underground hears nothing, which soundBroadcast decides.
const BELL_HOPS = 7;
const BELL_LOUD_HOPS = 4;

// Thirty minutes. Long enough that nobody can peal it into noise, short enough
// that it stays usable as a signal people agree on beforehand. Hardcoded rather
// than a GameConfig knob — there is one rope and one right answer.
const BELL_COOLDOWN_MS = 30 * 60 * 1000;

// One line, whatever the distance — see soundBroadcast.js on why a bell never
// muffles. It opens "You hear" because every audible thing in the game does.
const BELL_LINE = "You hear a church bell ringing.";

// What somebody types to pull the rope. The word is a speed bump, not a
// password — case and stray spaces are forgiven — and it lives here rather
// than in the bot's modal builder so Chat's confirm asks for the same one.
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
