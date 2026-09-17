// Move-amount display, HOISTED down from web/lib/recipeCatalog.js's workLabel
// (CRAFTING.md §2a): a recipe costing part of a turn would otherwise read as a
// whole Move. Lives HERE because db/ cannot import web/ —
// web/lib/craftBudget.js#formatMoveAmount re-exports this rather than keeping
// its own copy.
//
// Decimals, since 9/2026. This was a table of vulgar-fraction glyphs (¼, ⅓,
// ⅔…) because costs were authored as `1/N`; they are decimals now and the
// glyphs went with them.
//
// Takes a num/den pair because that is what the Move ledger holds
// (web/lib/craftBudget.js keeps exact rationals so a turn adds up), and prints
// the quotient: 0.25, 0.5, 1, 1.5. Trailing zeroes are trimmed, so a whole Move
// reads "1" and not "1.00". Two decimal places is the cap, which only a spill
// against an odd ration can reach — a ration of 3 bills a third of a Move and
// prints 0.33.
function formatMoveAmount(num, den = 1) {
  const value = den ? num / den : 0;
  return String(Number(value.toFixed(2)));
}

// Null when there's nothing to report (0 turns or no requirement block).
// `requirementTurns` is read AS AUTHORED, never defaulted to 1 like the
// craft/heal engines do — a tag with no requirement block stays silent.
function turnsLabel(tag) {
  if (!tag.requirementTurns) return null;
  const turns = tag.requirementTurns;
  // "1 turn", and everything else plural — including the part-turns, which read
  // as "0.25 turns" rather than "0.25 of a turn" so the column stays scannable
  // against the whole numbers beside it.
  return `${formatMoveAmount(turns)} turn${turns === 1 ? "" : "s"}`;
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

module.exports = { formatTagRequirement, formatMoveAmount };
