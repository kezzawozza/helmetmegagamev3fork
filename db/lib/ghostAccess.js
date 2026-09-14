// The Ghost role's seat — read-only visibility for the dead. A player who dies keeps it until buried
// or engraved (docs/documents.yaml, Respawning); while on they see every zone (cave levels included)
// plus #cerberon, but private threads stay invisible to non-members. CHANNEL ACCESS ONLY — whether a
// player is Cursed (migrant/bum only, six fewer points) is a database question db/lib/curse.js
// answers; nothing here decides anything about a player. Mirrors db/lib/spectatorAccess.js except
// ADD_REACTIONS is allowed (so a ghost can still ⭐ onto their own /notes page) and MANAGE_THREADS is
// denied by name. Role COLOR is pinned to 0 by ensureGhostRoleAppearance — a colored role would out
// who is dead in the member list. Role id is hardcoded in db/lib/roleIds.js, not an env var.
const { putChannelOverwrite, patchGuildRole } = require("./discordRest");
const { GHOST_ROLE_ID } = require("./roleIds");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_ADD_REACTIONS = 64n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_MANAGE_THREADS = 17179869184n;
const PERM_CREATE_PUBLIC_THREADS = 34359738368n;
const PERM_CREATE_PRIVATE_THREADS = 68719476736n;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944n;

const GHOST_ALLOW = PERM_VIEW_CHANNEL | PERM_ADD_REACTIONS;
const GHOST_DENY =
  PERM_SEND_MESSAGES |
  PERM_ATTACH_FILES |
  PERM_MANAGE_MESSAGES |
  PERM_MANAGE_THREADS |
  PERM_CREATE_PUBLIC_THREADS |
  PERM_CREATE_PRIVATE_THREADS |
  PERM_SEND_MESSAGES_IN_THREADS;

function ghostRoleId() {
  return GHOST_ROLE_ID;
}

// The overwrite object for inlining into a createChannel() permission_overwrites array, same shape as
// spectatorOverwrite() and the GM overwrite so call sites can spread it. Never empty: id is a constant.
function ghostOverwrite() {
  return [{ id: GHOST_ROLE_ID, type: 0, allow: GHOST_ALLOW.toString(), deny: GHOST_DENY.toString() }];
}

// The REST equivalent, for channels that already exist. One PUT that adds/updates just this
// overwrite without disturbing the channel's others — safe to re-run.
async function applyGhostOverwrite(channelId) {
  if (!channelId) return false;
  await putChannelOverwrite(channelId, GHOST_ROLE_ID, {
    allow: GHOST_ALLOW.toString(),
    deny: GHOST_DENY.toString(),
  });
  return true;
}

// Pins the ghost role's appearance: color 0 (default name color, no tint), never hoisted. One PATCH,
// idempotent, called from the zone sync and the channel doctor.
async function ensureGhostRoleAppearance() {
  await patchGuildRole(GHOST_ROLE_ID, { color: 0, hoist: false });
  return true;
}

module.exports = {
  ghostRoleId,
  ghostOverwrite,
  applyGhostOverwrite,
  ensureGhostRoleAppearance,
  GHOST_ALLOW,
  GHOST_DENY,
};
