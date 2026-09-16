// Armour, as the game shows it and as the guns roll against it. Two numbers live on every piece of
// gear (Tag.meleeArmor, Tag.ballisticArmor, both 0.0-1.0). This file owns the word a number is shown
// as and how several worn pieces combine — the severity ladder and odds stay in db/lib/depotTurret.js.
// Pure and Prisma-free, so both faces and the sync can use it.

// Words, never numbers, the same posture db/lib/laborYield.js#qualityWord takes for Laboring — kit
// choice stays a judgement, not a spreadsheet. Six steps over 0..1; "None" covers absent as well as zero.
const ARMOR_WORDS = [
  { below: 0.001, word: "None" },
  { below: 0.2, word: "Meager" },
  { below: 0.4, word: "Sufficient" },
  { below: 0.6, word: "Good" },
  { below: 0.8, word: "Strong" },
  { below: Infinity, word: "Overkill" },
];

// The one place an armour value becomes a word.
function armorWord(value) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "None";
  return ARMOR_WORDS.find((step) => value < step.below).word;
}

// Nothing is ever bulletproof — capped here so a GM authoring 1.0 gets "very good", not "immune".
const ARMOR_CAP = 0.95;

// How worn pieces stack: multiplicative on what gets THROUGH, not additive on what's stopped — a 40%
// and a 25% piece leave 0.6 * 0.75 = 45% through (0.55 combined), rewarding a full kit while making
// each added piece worth less than the last. `field` picks which of the two numbers to read.
function combineArmor(characterTags = [], field = "ballisticArmor") {
  let through = 1;
  for (const entry of characterTags) {
    // Armour only counts EQUIPPED — a vest in your cart stops nothing. `!== false` (not a boolean
    // check) so a bare Tag[] with no equipped flag still works.
    if (entry?.equipped === false) continue;
    const tag = entry?.tag ?? entry;
    const value = tag?.[field];
    if (typeof value !== "number" || Number.isNaN(value) || value <= 0) continue;
    through *= 1 - Math.min(1, value);
  }
  // Rounded, not the raw float — IEEE 754 error would push a value authored at exactly a band's edge
  // (0.2, 0.4, 0.6, 0.8) into the word below it, since armorWord compares with a strict `<`.
  return Math.round(Math.min(ARMOR_CAP, 1 - through) * 10000) / 10000;
}

// WHICH worn pieces are stopping anything, best first. combineArmor above answers "how much gets
// through"; this answers "what is turning the blow aside", which is the question an adjudicating GM
// actually has. Same equipped-only rule and the same `{ tag: {...} }`-or-bare-Tag latitude.
// A piece is named with the word it earns ALONE — never a share of the combined value, because the
// stacking is multiplicative and there is no honest way to split it.
function armorPieces(characterTags = [], field = "ballisticArmor") {
  const out = [];
  for (const entry of characterTags) {
    if (entry?.equipped === false) continue;
    const tag = entry?.tag ?? entry;
    const value = tag?.[field];
    if (typeof value !== "number" || Number.isNaN(value) || value <= 0) continue;
    out.push({ label: tag.name ?? tag.slug ?? "Something", word: armorWord(value), value });
  }
  // Heaviest piece first, then by name, so the list is stable between renders.
  out.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return out;
}

// The Tag columns anything resolving armour must select. Miss one and armour silently stops working there.
// armorPieces() additionally wants `name` (or `slug`) to have something to call a piece; every caller
// today selects it anyway, so it stays out of here rather than widening a select nobody asked to widen.
const ARMOR_TAG_FIELDS = { meleeArmor: true, ballisticArmor: true };

module.exports = { ARMOR_CAP, ARMOR_TAG_FIELDS, armorPieces, armorWord, combineArmor };
