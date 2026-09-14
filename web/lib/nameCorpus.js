// Deep-path re-export: CreateCharacterWizard.js/BioNameFields.js are client components and the
// @lifeweb/db barrel would construct a PrismaClient in the browser bundle. Named, not `export *`
// (target is CommonJS; a star re-export makes Turbopack warn). Safe to bundle: nameCorpus.js is pure.
export {
  NAME_CORPUS,
  FLAVOUR_CHANCE,
  CROSS_REGION_CHANCE,
  WITCHER_SHARE_OF_FLAVOUR,
  randomCharacterName,
} from "@lifeweb/db/lib/nameCorpus";
