// Shim so CreateCharacterWizard.js (client component) avoids importing @lifeweb/db's barrel.
// Named rather than `export *`: the target is CommonJS, so a star re-export warns on every build.
export {
  THREATS,
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  threatBySlug,
  threatBySeatTag,
  PARTIES,
  partyOf,
  optInName,
  optInWhitelisted,
  WHITELISTED_OPT_IN_SLUGS,
  ANTAGONISTS,
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
} from "@lifeweb/db/lib/threats";
