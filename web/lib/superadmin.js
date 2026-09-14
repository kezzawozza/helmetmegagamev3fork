import { SUPERADMIN_DISCORD_IDS } from "@lifeweb/db/lib/roleIds";

// Canonical list lives in db/lib/roleIds.js; re-exported here since other web/ modules already
// import it from this file.
export { SUPERADMIN_DISCORD_IDS };

// Under LOCAL_MODE a locally-signed-in session still carries a real discordUserId, so this check
// still applies — only db/lib/localMode.js#localMember's Discord-call interception needs a bypass.
export function isSuperadmin(discordUserId) {
  return !!discordUserId && SUPERADMIN_DISCORD_IDS.includes(discordUserId);
}
