// The trumpet: the bell's portable cousin, sounding from wherever the holder stands rather than a fixed tower. Button on the web Character page (not Discord) since "only if you have one" is per-reader. Takes `prisma` as a parameter, off the @lifeweb/db barrel — require by path.
const { broadcastSound } = require("./soundBroadcast");
const { BELL_HOPS, BELL_LOUD_HOPS, BELL_COOLDOWN_MS } = require("./bell");

// Three-quarters of the bell's reach, derived from it rather than written out — retuning the bell should move the trumpet with it. At today's numbers that is 5 hops with the first 3 at full size.
const TRUMPET_HOPS = Math.round(BELL_HOPS * 0.75);
const TRUMPET_LOUD_HOPS = Math.round(BELL_LOUD_HOPS * 0.75);

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
