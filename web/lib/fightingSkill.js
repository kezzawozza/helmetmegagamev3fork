// Deep-path re-export avoids the @lifeweb/db barrel (would leak node:fs into a "use client" bundle).
// Named, not `export *`: target is CommonJS, so a star re-export makes Turbopack warn on every build.
export { fightingSkill, fightingWord, formatFightingSkill, TREES } from "@lifeweb/db/lib/fightingSkill";
