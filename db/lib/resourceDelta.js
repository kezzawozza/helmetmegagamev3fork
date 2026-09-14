// A Labor roll is stored as a canonical "min-max" range on Action.resourceRollExpression — resolved once at submit time (db/lib/laborAccess.js), rolled once at confirm (bot/src/lib/moveConfirm.js) or at the auto-labor pass. StagedEffect stages a numeric delta directly; Action columns are read for display only.

const RANGE_EXPR_RE = /^(\d+)-(\d+)$/;

// Returns null if the stored expression is malformed — a leftover pre-notation row can land here too, and callers already guard on a falsy result.
function rollResourceRange(expression) {
  const match = RANGE_EXPR_RE.exec(expression ?? "");
  if (!match) return null;

  const min = Number.parseInt(match[1], 10);
  const max = Number.parseInt(match[2], 10);
  return { min, max, value: min + Math.floor(Math.random() * (max - min + 1)) };
}

function formatRangeExpression(expression) {
  const match = RANGE_EXPR_RE.exec(expression ?? "");
  return match ? `${match[1]}–${match[2]}` : expression;
}

module.exports = {
  rollResourceRange,
  formatRangeExpression,
};
