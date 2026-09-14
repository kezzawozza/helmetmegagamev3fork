// Static Discord role IDs (and one user-ID allowlist), hardcoded rather than
// env-configured: a role ID is not a secret, Bascinet is single-guild so
// there is one correct value, and a missing env var here would fail silently
// (locked-out players, a dead spectator overwrite). DISCORD_TOKEN and the
// guild/GM-role env vars stay in the environment instead.

// Who may create a character or ready up. Paired with GameState.phase: the
// phase says the doors are open, this role says who is on the list.
const PLAYER_ROLE_ID = "1539805619903791219";

// The standing read-only observer seat — sees every Location channel and both
// narrowcast channels, can never contribute anything anywhere.
const SPECTATOR_ROLE_ID = "1540054129752154292";

// Who may pick a role flagged `whitelist:` in docs/roles.yaml, handed out by
// a GM rather than earned in-game. Reads as "Whitelist" in the guild's role
// list — match by name if you ever have to check this ID; the gate fails
// closed and silently if it points at a deleted role.
const LEADER_WHITELIST_ROLE_ID = "1545070354295169214";

// The playtest seat: counts as on the roster without the Player role, but
// does NOT skip the lobby — only a GM keeps the Skip button. Grants nothing
// else. Reads as "Playtest"; unmentionable and uncoloured so
// db:prune-orphan-roles never mistakes it for a character's name token.
const PLAYTEST_ROLE_ID = "1546259369539280936";

// The people building this game, distinct from the Playtest testing bypass.
// Grants nothing on its own; read by exactly one gate — GameConfig.playtestModeEnabled.
// Reads as "Contributor" in the guild.
const CONTRIBUTOR_ROLE_ID = "1544753625526440027";

// The ghost seat: read-only visibility for a dead player, nothing else.
// Reads as "Ghost" in the guild. A permission handle only — whether a player
// is Cursed is answered by db/lib/curse.js from Character.status/buriedAt,
// not this role. The death path writes it; the channel doctor reconciles it.
const GHOST_ROLE_ID = "1540018826580852736";

// The trial GM seat. Access-identical to the Gamemaster role everywhere — the
// web panel, the GM channel overwrites, the bot's /gm and /dm — and the only
// difference is the word the GM roster on /gm/dev puts next to the name.
const TRIAL_GM_ROLE_ID = "1545942420271931543";

// Discord user IDs allowed onto the /gm/dev panel — host/developer access,
// not a game permission, not a Discord role. Canonical here so
// db/lib/localMode.js can read it without web/ importing back into db/;
// web/lib/superadmin.js re-exports it.
const SUPERADMIN_DISCORD_IDS = ["1507184027919057108", "262426987979735040", "216301927242137600"];

// Every role that counts as a GM, in one place — never check DISCORD_GM_ROLE_ID
// directly, or a site checking only one role drifts into a GM who can open the
// web panel but not the channels, or the reverse.
function gmRoleIds() {
  return [process.env.DISCORD_GM_ROLE_ID, TRIAL_GM_ROLE_ID].filter(Boolean);
}

function hasGmRole(roleIds) {
  const ids = gmRoleIds();
  return (roleIds ?? []).some((id) => ids.includes(id));
}

function hasPlaytestRole(roleIds) {
  return (roleIds ?? []).includes(PLAYTEST_ROLE_ID);
}

function hasContributorRole(roleIds) {
  return (roleIds ?? []).includes(CONTRIBUTOR_ROLE_ID);
}

module.exports = {
  PLAYER_ROLE_ID,
  SPECTATOR_ROLE_ID,
  GHOST_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
  TRIAL_GM_ROLE_ID,
  PLAYTEST_ROLE_ID,
  CONTRIBUTOR_ROLE_ID,
  SUPERADMIN_DISCORD_IDS,
  gmRoleIds,
  hasGmRole,
  hasPlaytestRole,
  hasContributorRole,
};
