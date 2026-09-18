// Cutting Godflesh: the die, the yield, the hand you might not come back
// with. Modelled on db/lib/depotTurret.js, but only reaches the table on a 1
// — routine work, not a coin flip. Kept a two-column gloves/no-gloves table
// on purpose (unlike the turret's tag curve) — a general armour value would
// misrepresent what stands between a chainsaw and your hand. Pure and Prisma-free. See docs/systemdocs/FACTORY.md.

const { turnDay } = require("./turnFormat");

const EXTRACT_TOOLS = ["chainsaw", "battle-axe", "hatchet"];
const CHAINSAW_SLUG = "chainsaw";
const ARMORED_GLOVES_SLUG = "armored-gloves";
const GODFLESH_SLUG = "godflesh";

// Gloves are 2 ⬢ to craft and every Factory role starts with a pair; columns sum to 1.
const INJURY_TABLE = {
  none: { "missing-fingers": 0.45, "mangled-hand": 0.4, "missing-arm": 0.15 },
  gloves: { "minor-wound": 0.75, "deep-wound": 0.25 },
  "gloves-armored": { "minor-wound": 0.9, "deep-wound": 0.1 },
};

const BODY_ARMOR_SLUGS = [
  "plate-armor", "breastplate", "brigandine", "mail-shirt", "salvage-plate",
  "light-infantry-armour", "padded-armor",
];

const SUM_EPSILON = 0.0001;

for (const [key, column] of Object.entries(INJURY_TABLE)) {
  const sum = Object.values(column).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > SUM_EPSILON) {
    throw new Error(`godflesh.js: injury column "${key}" sums to ${sum}, not 1`);
  }
}

// Equipped only. A custom craft (CRAFTING.md §4a) mints a fresh
// `custom-craft-*` slug — without customOfSlug a signed breastplate would stop being body armour.
function equippedSlugSet(characterTags = []) {
  return new Set(
    characterTags
      .filter((ct) => ct?.equipped === true)
      .map((ct) => {
        const tag = ct?.tag ?? ct;
        return tag?.customOfSlug ?? tag?.slug;
      })
      .filter(Boolean),
  );
}

function extractToolFor(characterTags = []) {
  const worn = equippedSlugSet(characterTags);
  return EXTRACT_TOOLS.find((slug) => worn.has(slug)) ?? null;
}

function injuryColumnFor(characterTags = []) {
  const worn = equippedSlugSet(characterTags);
  if (!worn.has(ARMORED_GLOVES_SLUG)) return "none";
  return BODY_ARMOR_SLUGS.some((slug) => worn.has(slug)) ? "gloves-armored" : "gloves";
}

function rollExtraction(characterTags, rng = Math.random) {
  const tool = extractToolFor(characterTags);
  const die = 1 + Math.floor(rng() * 6);

  let quantity = tool === CHAINSAW_SLUG ? 2 : 1;
  if (die === 6) quantity += 1;

  if (die !== 1) return { die, tool, quantity, injury: null };

  const column = injuryColumnFor(characterTags);
  let roll = rng();
  for (const [tagSlug, weight] of Object.entries(INJURY_TABLE[column])) {
    roll -= weight;
    if (roll <= 0) return { die, tool, quantity, injury: { column, tagSlug } };
  }
  const [mildest] = Object.keys(INJURY_TABLE[column]);
  return { die, tool, quantity, injury: { column, tagSlug: mildest } };
}

function extractionDm(result, { locationName = null } = {}) {
  const where = locationName ? ` at ${locationName}` : "";
  const lines = [`*You went out into the marsh${where} and cut.*`, `**Roll (1d6):** ${result.die}`];

  if (result.injury) {
    lines.push(
      "» *It got a hand round your wrist before you got the blade in.*",
      result.injury.column === "none"
        ? "-# You were not wearing your Armored Gloves."
        : "-# Your Armored Gloves took most of it.",
    );
  } else if (result.die === 6) {
    lines.push("» *A good seam. It came away in one piece and then some.*");
  }

  lines.push(`**Godflesh:** +${result.quantity}`);
  return lines.join("\n");
}

// Character.extractDayKey, the in-game DAY (FACTORY.md §3, BIRD.md) — a day
// can be several turns, so keying on the turn id would give several cuts a day.
function extractDayKey(openTurn) {
  return openTurn ? String(turnDay(openTurn)) : null;
}

// Read-side only, for greying the button — the WRITE side (extractGodfleshRequest's conditional updateMany) is the real check; two tabs can both pass this.
function extractedToday(character, openTurn) {
  const key = extractDayKey(openTurn);
  return Boolean(key && character?.extractDayKey === key);
}

module.exports = {
  GODFLESH_SLUG,
  extractToolFor,
  rollExtraction,
  extractionDm,
  extractDayKey,
  extractedToday,
};
