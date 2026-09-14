// A handle for somebody in a hood that says nothing about who they are: an HMAC of the id keyed with
// AUTH_SECRET, since /api/avatar/<id> would unmask a raw Character.id. No AUTH_SECRET means no token at
// all — never an HMAC under an empty key, which would be an unmasking oracle. Zero-requires leaf beside
// dmKinds.js, for the same reason: avoids pulling in the whosHere.js -> sightings.js -> feedAccess.js chain.
const crypto = require("node:crypto");

function hoodToken(characterId) {
  if (!characterId || !process.env.AUTH_SECRET) return null;
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`hood:${characterId}`)
    .digest("hex")
    .slice(0, 32);
}

module.exports = { hoodToken };
