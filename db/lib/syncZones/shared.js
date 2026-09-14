// syncZones shared helpers, used by 2+ of the split modules. Split out of
// db/lib/syncZones.js — see that file.
const crypto = require("node:crypto");

const CHANNEL_TYPE_CATEGORY = 4;

function hashBody(body) {
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 32);
}

module.exports = {
  CHANNEL_TYPE_CATEGORY,
  hashBody,
};
