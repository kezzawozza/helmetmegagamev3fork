// A suffix of zero-width chars appended to the WEBHOOK username of a
// concealed proxy send, so two hooded characters sharing an alias
// ("Young Man" and "Young Man") stop rendering as one collapsed block in
// Discord. Two men in one room posting alternately read as two speakers, not
// one.
//
// Pure — no prisma, no I/O. Called from both proxy paths
// (bot/src/lib/proxy.js#postAsCharacterTo and
// db/lib/discordRest.js#postAsCharacter), never stored: the archive keeps the
// plain alias, and every game-facing surface (/chat, /archive, HERE, Look at,
// mentions, ⭐, 📸) reads that clean row.
//
// Scoped to (turnNumber, placeKey) so it rolls over daily and per scene. A
// stable per-character suffix would be a cross-scene fingerprint — the exact
// thing "the sprite says WHAT is over the face, never who is behind it"
// (PROXYING.md §3) exists to prevent.
const crypto = require("node:crypto");

const ZWSP = "​";
const ZWNJ = "‌";
const BITS = 6;

function concealDiscriminator({ characterId, turnNumber = null, placeKey = null } = {}) {
  if (!characterId) return "";
  // Nothing to key against — no suffix, and grouping is unchanged. Every real
  // send has at least a placeKey, so this is defence in depth for tests and
  // odd future callers rather than a code path that fires in production.
  if (turnNumber == null && placeKey == null) return "";
  const material = `${characterId}|${turnNumber ?? ""}|${placeKey ?? ""}`;
  const digest = crypto.createHash("sha256").update(material).digest();
  let suffix = "";
  for (let i = 0; i < BITS; i += 1) {
    const bit = (digest[i >> 3] >> (i & 7)) & 1;
    suffix += bit ? ZWNJ : ZWSP;
  }
  return suffix;
}

module.exports = { concealDiscriminator, ZWSP, ZWNJ };
