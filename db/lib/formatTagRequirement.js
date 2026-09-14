// Move-fraction display, HOISTED down from web/lib/recipeCatalog.js's
// workLabel (CRAFTING.md §2a): a `turnsCost: 1/N` recipe stores as
// requirementTurns: 1 + requirementPerTurn: N (db/lib/tagShapes.js), and a
// plain "1 turn" line would read as a whole Move where the true cost is a
// fraction. Lives HERE because db/ cannot import web/ —
// web/lib/craftBudget.js#formatMoveFraction re-exports this rather than
// keeping its own copy.
const FRACTION_GLYPHS = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  // Mixed denominators land on sixths; twelfths have no glyphs and fall through to "n/m".
  "1/6": "⅙",
  "5/6": "⅚",
  "1/8": "⅛", // kept for other fractional recipes even though the medical pool moved off it
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

function formatMoveFraction(num, den) {
  return FRACTION_GLYPHS[`${num}/${den}`] ?? `${num}/${den}`;
}

// Null when there's nothing to report (0 turns or no requirement block).
// `requirementTurns` is read AS AUTHORED, never defaulted to 1 like the
// craft/heal engines do — a tag with no requirement block stays silent.
function turnsLabel(tag) {
  if (!tag.requirementTurns) return null;
  const per = tag.requirementPerTurn ?? null;
  if (tag.requirementTurns === 1 && per > 1) {
    return `${formatMoveFraction(1, per)} turn`;
  }
  return `${tag.requirementTurns} turn${tag.requirementTurns === 1 ? "" : "s"}`;
}

// Minified "cost to add/remove this tag in play" summary, wherever a tag's
// description already renders. Lives here since both web/ and bot/ depend on
// @lifeweb/db and would otherwise duplicate it. Returns null with no
// requirement data set. Callers must fetch requirementTurns,
// requirementResources, requirementGambit, requirementItems,
// requirementPerTurn, and requirementSkills ({ name: true }) — a caller that
// forgets requirementItems silently renders no ingredient line rather than throwing.
function formatTagRequirement(tag) {
  const parts = [];
  // Spelled out, not "1t": the chip face's `Nt` badge already means turns REMAINING.
  const turnsText = turnsLabel(tag);
  if (turnsText) parts.push(turnsText);
  if (tag.requirementResources) parts.push(`${tag.requirementResources} ⬢`);
  if (tag.requirementSkills?.length) {
    // " + ", not "/": requirementSkills is an AND (every skill must be held, see requireRecipeSkills).
    parts.push(tag.requirementSkills.map((t) => t.name).join(" + "));
  }
  // `label` is denormalized into the stored Json by the sync so this stays pure/synchronous
  // (tagShapes.js). Spent vs kept read differently — "uses X" means the stack goes down, "needs X
  // to hand" means it doesn't.
  if (tag.requirementItems?.length) {
    // Count above 1 rides on the label ("uses Paper ×10") since the number is the whole bargain.
    const spent = tag.requirementItems
      .filter((i) => !i.keep)
      .map((i) => ((i.count ?? 1) > 1 ? `${i.label} ×${i.count}` : i.label));
    const kept = tag.requirementItems.filter((i) => i.keep).map((i) => i.label);
    if (spent.length) parts.push(`uses ${spent.join(" and ")}`);
    if (kept.length) parts.push(`needs ${kept.join(" and ")} to hand`);
  }
  // The Move kind is always stated once there's something to qualify — a tag with no requirement
  // block still renders nothing rather than a bare "Routine".
  if (parts.length === 0 && !tag.requirementGambit) return null;
  parts.push(tag.requirementGambit ? "Gambit" : "Routine");
  return parts.join(" · ");
}

module.exports = { formatTagRequirement, formatMoveFraction };
