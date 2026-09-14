// What 🔍-inspecting another character shows you beyond their appearance. Seductive (the Demoness
// tag, docs/tags.yaml's hidden `demoness` category) buys automatic read access to a sheet's last
// fulfilled Desire; Mindreading reads the same fact only via a GM-adjudicated Gambit. No Prisma
// import; imported by subpath from both bot/ and web/ so the rule can't drift.
const { SEDUCTIVE_DEMONESS_SLUG } = require("./constants");

// A list, not a bare slug, so another tag can be added without touching the check below.
const DESIRE_SIGHT_SLUGS = [SEDUCTIVE_DEMONESS_SLUG];

// Accepts CharacterTag[] (`{ tag: { slug } }`) or a bare Tag[].
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Read off the VIEWER: what they can see when they inspect anyone.
function inspectVision(characterTags = []) {
  const slugs = slugSet(characterTags);
  return {
    canSeeDesire: DESIRE_SIGHT_SLUGS.some((slug) => slugs.has(slug)),
  };
}

module.exports = { inspectVision };
