// The guild nickname budget: base account name, a separator, the character's
// bare name, clamped to Discord's 32-char cap and split roughly evenly when
// the two together don't fit. Shared because bot/src/lib/nickname.js (the
// gateway sync) and web/lib/discordGuild.js (the REST sync) used to keep this
// in sync by hand — see CLAUDE.md on db/lib for why a shared rule belongs here
// instead of two copies that can drift.
const NICK_MAX = 32;
const NICK_SEP = " | ";

function buildNickname(base, characterName) {
  const budget = NICK_MAX - NICK_SEP.length;
  const a = (base || "").trim();
  const b = (characterName || "").trim();
  if (a.length + b.length <= budget) return `${a}${NICK_SEP}${b}`;

  const aMax = Math.ceil(budget / 2);
  const truncA = a.slice(0, Math.min(a.length, aMax));
  const truncB = b.slice(0, budget - truncA.length);
  return `${truncA}${NICK_SEP}${truncB}`;
}

module.exports = { buildNickname };
