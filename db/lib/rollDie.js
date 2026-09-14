// The Move d6, on its own so db/lib/advantage.js can roll one without requiring db/lib/moveEffects.js back (a CJS cycle). Stays exported from moveEffects too, so every existing `require("./moveEffects").rollDie` keeps resolving — the adjudication panel rerolls this die when a GM switches a Routine to a Gambit, and the two must be the same die.
function rollDie(sides = 6) {
  return 1 + Math.floor(Math.random() * sides);
}

module.exports = { rollDie };
