// Static — what speech sounds like when you only half catch it. Pure, no prisma/I/O. Two systems must garble text the same way — db/lib/shout.js by distance, bot/src/lib/whisperPoll.js's Room overhears — so this is the one implementation. It answers HOW MUCH is lost, never how much SHOULD be; the fraction is the caller's.

const BLOCKS = ["░", "▒", "▓"];

function muffle(text, fraction, rng = Math.random) {
  if (fraction <= 0) return text;
  return Array.from(String(text))
    .map((ch) => {
      if (/\s/.test(ch)) return ch;
      if (rng() >= fraction) return ch;
      return BLOCKS[Math.floor(rng() * BLOCKS.length)];
    })
    .join("");
}

module.exports = { muffle };
