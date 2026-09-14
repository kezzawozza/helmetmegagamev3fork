// Deep-path re-export: CreateCharacterWizard.js is a client component, and the @lifeweb/db barrel
// would construct a PrismaClient in the browser bundle. Named, not `export *` (Turbopack warns).
export {
  NAME_LIMITS,
  FULL_NAME_LIMIT,
  AGE_MIN,
  AGE_MAX,
  formatCharacterName,
  formatBareName,
  nameKey,
  matchesTypedName,
  splitLegacyName,
  normalizeHonorific,
  normalizeEarnedHonorific,
} from "@lifeweb/db/lib/characterName";

// The title catalog, same shim reason — the wizard and other pickers are client components.
export { TITLE_WORDS, GENDERS, earnedTitles } from "@lifeweb/db/lib/titles";

// How the Gender enum is written for a human. Lives here, not db/lib/titles.js — presentation only.
export const GENDER_LABELS = Object.freeze({
  MAN: "Man",
  WOMAN: "Woman",
  NEUTRAL: "Neutral",
});
