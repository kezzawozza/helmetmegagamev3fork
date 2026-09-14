// The one place a character role's name/colour are composed. The three renamers
// (web/lib/discordGuild.js#ensureCharacterRole, the Catatonic pass, db/lib/characterRoleNames.js)
// must go through here, or one landing mid-catatonia strips the "• Catatonic" suffix another wrote.
const { hashNameToColor } = require("./roleColor");

// Non-zero on purpose — 0 means "no colour" to Discord and is the cursed role's deliberate pin (CHANNELS.md §3).
const CATATONIC_ROLE_COLOR = 0x4e5457;

const CATATONIC_ROLE_SUFFIX = " • Catatonic";

// forcedName (Disguise Kit / Apex Form) renames the role INSTEAD of the bare name, colour included — see PROXYING.md §6.
// A HOOD is deliberately not here: a concealed message relays nothing at all, so nothing needs a role rename (PROXYING.md §6).
function characterRoleAppearance(bareName, { catatonic = false, forcedName = null } = {}) {
  const shown = forcedName?.trim() || bareName;
  if (catatonic) {
    return { name: `${shown}${CATATONIC_ROLE_SUFFIX}`, color: CATATONIC_ROLE_COLOR };
  }
  return { name: shown, color: hashNameToColor(shown) };
}

module.exports = { characterRoleAppearance, CATATONIC_ROLE_COLOR, CATATONIC_ROLE_SUFFIX };
