// Deep-path re-export avoids the @lifeweb/db barrel (would leak node:fs into this "use client" bundle).
// Named, not `export *`: target is CommonJS, so a star re-export makes Turbopack warn on every build.
export { armorPieces, combineArmor, armorWord } from "@lifeweb/db/lib/armorValue";
