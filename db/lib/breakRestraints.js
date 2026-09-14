// Break Restraints, the pure half (docs/systemdocs/LESSONS.md §3c). A Bound
// character's own Gambit at freedom, once a turn: the longer they've been
// tied up, the easier it gets. Prisma-free, the same posture as torture.js:
// the web action loads the rows, this decides, the test reads it directly.
//
// Off the @lifeweb/db barrel on purpose; require it by path.

const { formatAdvantage } = require("./advantage");

const ESCAPE_ARTIST_SLUG = "escape-artist";
const GIANT_SLUG = "giant";

function toSet(slugs) {
  return slugs instanceof Set ? slugs : new Set(slugs ?? []);
}

// The threshold a die must reach or beat, or `null` for automatic — no roll
// needed, it just works. `turnsElapsed` is `openTurn.number -
// character.boundSinceTurnNumber`, 0 on the same turn the bind landed.
//
// Escape Artist shifts the whole ladder one turn early (their turn 1 plays
// like everyone else's turn 2). Giant only sweetens turn 1 — Bascinet gave
// no reason to shift its later turns, so turn 2+ falls back to the base
// ladder. Escape Artist AND Giant together is Bascinet's own ruling: instant,
// from turn 1, no exceptions.
function breakRestraintsThreshold(turnsElapsed, heldSlugs) {
  const held = toSet(heldSlugs);
  const elapsed = Math.max(0, turnsElapsed);
  const escapeArtist = held.has(ESCAPE_ARTIST_SLUG);
  const giant = held.has(GIANT_SLUG);

  if (escapeArtist && giant) return null;
  if (elapsed >= 2) return null;
  if (escapeArtist) return elapsed >= 1 ? null : 3;
  if (giant) return elapsed >= 1 ? 3 : 4;
  return elapsed >= 1 ? 3 : 5;
}

// `die` is what was actually rolled (irrelevant when the result is
// automatic, but the caller always has one from rollWithAdvantage).
function resolveBreakRestraints({ die, turnsElapsed, heldSlugs }) {
  const threshold = breakRestraintsThreshold(turnsElapsed, heldSlugs);
  const automatic = threshold == null;
  return { die, threshold, automatic, success: automatic || die >= threshold };
}

// "Rolled a 4 against 3" / "Rolled a 6 (6, 2 — Lucky) against 3" — same shape
// as torture.js#formatTortureRoll, minus a modifiers list this roll has none
// of. Never called when the result is automatic — there's no die to report.
function formatBreakRestraintsRoll({ die, threshold, rolls = null }) {
  const luck = formatAdvantage({ rolls, advantage: (rolls?.length ?? 0) > 1 });
  return `Rolled a ${die}${luck ? ` ${luck}` : ""} against ${threshold}`;
}

module.exports = {
  ESCAPE_ARTIST_SLUG,
  GIANT_SLUG,
  breakRestraintsThreshold,
  resolveBreakRestraints,
  formatBreakRestraintsRoll,
};
