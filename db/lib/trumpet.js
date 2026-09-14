// The trumpet. The bell's portable cousin: same machine, three-quarters the
// reach, and it sounds from wherever the person holding it happens to be
// standing rather than from a fixed tower.
//
// That difference is the whole point of it. A bell says something is happening
// at the Cathedral. A trumpet says something is happening HERE, and the herald
// decides where here is.
//
// The button is on the web Character page rather than in Discord, because
// "only if you have one" is a per-reader question and a Discord button sits on
// an anchor message everybody shares.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { broadcastSound } = require("./soundBroadcast");
const { BELL_HOPS, BELL_LOUD_HOPS, BELL_COOLDOWN_MS } = require("./bell");

// Three-quarters of the bell's reach, rounded, and derived from it rather than
// written out: the ratio is the design, so retuning the bell should move the
// trumpet with it instead of quietly leaving the two to disagree.
//
// At today's numbers that is 5 hops with the first 3 at full size.
const TRUMPET_HOPS = Math.round(BELL_HOPS * 0.75);
const TRUMPET_LOUD_HOPS = Math.round(BELL_LOUD_HOPS * 0.75);

// The same half hour the rope gets.
const TRUMPET_COOLDOWN_MS = BELL_COOLDOWN_MS;

const TRUMPET_LINE = "You hear a loud, heraldic trumpet.";

async function broadcastTrumpet(prisma, originLocationId) {
  return broadcastSound(prisma, {
    originLocationId,
    text: TRUMPET_LINE,
    maxHops: TRUMPET_HOPS,
    loudHops: TRUMPET_LOUD_HOPS,
  });
}

module.exports = {
  TRUMPET_COOLDOWN_MS,
  broadcastTrumpet,
};
