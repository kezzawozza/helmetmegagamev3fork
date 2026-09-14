// The Rookery: what a building does to the Bird's daily allowance (BIRD.md). Raises `placement.birdSendsPerDay` (docs/tags.yaml) and puts a
// three-minute wall clock between flights instead. Cooldown is a DateTime column, not an in-memory Map, because a bot restart must not hand a free flight, and the Bird is also sent from the WEB face, which can't see the bot's memory.

const { placementOf, WORKING_STATUSES } = require("./structures");

const ROOKERY_COOLDOWN_MS = 3 * 60_000;

const BASE_BIRD_SENDS_PER_DAY = 1;

// Biggest wins rather than summing, so two rookeries are not twice a rookery. `structures` are rows from db/lib/structures.js#structuresAt.
function birdAllowanceFrom(structures) {
  let best = BASE_BIRD_SENDS_PER_DAY;
  for (const s of structures ?? []) {
    // Damaged, not destroyed, is still a tower full of birds.
    if (!WORKING_STATUSES.includes(s.status)) continue;
    const n = s.placement?.birdSendsPerDay ?? placementOf(s.type)?.birdSendsPerDay;
    if (Number.isInteger(n) && n > best) best = n;
  }
  return best;
}

// `readyAt` is a unix second so the caller can hand Discord a live <t:…:R> (db/lib/discordMarkup.js).
function rookeryCooldown(birdLastSentAt, now = Date.now()) {
  if (!birdLastSentAt) return { ok: true, secondsLeft: 0, readyAt: null };
  const readyMs = new Date(birdLastSentAt).getTime() + ROOKERY_COOLDOWN_MS;
  const remaining = readyMs - now;
  if (remaining <= 0) return { ok: true, secondsLeft: 0, readyAt: null };
  return {
    ok: false,
    secondsLeft: Math.ceil(remaining / 1000),
    readyAt: Math.ceil(readyMs / 1000),
  };
}

module.exports = {
  ROOKERY_COOLDOWN_MS,
  BASE_BIRD_SENDS_PER_DAY,
  birdAllowanceFrom,
  rookeryCooldown,
};
