// Which picture #turns posts above a turn announcement.
//
// This replaces weatherBannerPath(), which keyed the file off the turn's rolled
// weather. With weather gone there are four plates per phase and nothing to key
// them on, so one is picked when the turn opens and remembered on the Turn row.
//
// Remembering it rather than re-rolling at post time matters because the
// announcement gets REPOSTED: the bot's cold start rebuilds a missing console
// (bot/src/lib/turnsConsole.js) and the wipe finisher reposts it. A fresh roll
// there would swap the picture out from under players mid-turn.
const fs = require("node:fs");
const path = require("node:path");
const { docsPath } = require("./repoPaths");

// docsPath returns null when docs/ can't be found at all — repoPaths.js says to
// treat that as "no banner". Guard every join: path.join(null, ...) throws, and
// a TypeError here would take down the whole announcement (the DAY/PHASE header,
// the console text, the Travel/Move/Speak buttons) over a missing image. This
// mainly bites the WEB container, where Turbopack inlines __dirname as a literal
// that doesn't exist.
const TURN_BANNER_DIR = docsPath("assets", "turn");

const PLATES_PER_PHASE = 4;

function platesFor(phase) {
  const stem = phase === "DUSK" ? "dusk" : "dawn";
  return Array.from({ length: PLATES_PER_PHASE }, (_, i) => `${stem}-${i + 1}.jpg`);
}

// Picks a plate for a phase, avoiding whatever the previous turn OF THE SAME
// PHASE used. Same phase, not simply the previous turn: turns alternate
// DAWN/DUSK, so the turn before a dawn is always a dusk and excluding its plate
// would exclude nothing. Comparing dawn against the last dawn is what actually
// stops a player seeing the same picture two mornings running.
function pickTurnBanner(phase, previousBanner = null) {
  const plates = platesFor(phase);
  const pool = plates.filter((p) => p !== previousBanner);
  const from = pool.length ? pool : plates;
  return from[Math.floor(Math.random() * from.length)];
}

// The banner the previous same-phase turn used, or null if there wasn't one.
async function lastBannerForPhase(prisma, phase) {
  const previous = await prisma.turn.findFirst({
    where: { phase },
    orderBy: { number: "desc" },
    select: { banner: true },
  });
  return previous?.banner ?? null;
}

// Convenience for the turn-creating paths: read the last same-phase banner and
// pick a different one.
async function nextTurnBanner(prisma, phase) {
  return pickTurnBanner(phase, await lastBannerForPhase(prisma, phase));
}

// Resolves a Turn to a file on disk. Returns null when there is nothing to post,
// which is the whole point of resolving it this way: a missing asset must cost
// the guild its banner, never its turn announcement.
//
// After the bomb there is no morning, only the sky. `state` (GameState) is
// optional so every existing caller keeps working; pass it and a detonated game
// pins the fireball on for good.
//
// THE STAMPS COME OFF `state.game`, NOT off GameState itself. Turn numbers
// restart at 1 every game, so the GameState copies said nothing about WHICH
// game had ended — and on 2026-09-09 a brand-new game posted the nuke plate
// above every one of its turns because the column from the last game was still
// sitting there. The Game row is created fresh by the wipe, so it cannot lie.
// Callers select `{ game: { select: { nukeDetonatedTurn, ascensionFiredTurn } } }`.
function turnBannerPath(turn, state = null) {
  if (!TURN_BANNER_DIR) return null;
  if (state?.game?.nukeDetonatedTurn != null) {
    const nuke = path.join(TURN_BANNER_DIR, "nuke.jpg");
    // Falls through to the ordinary plate if the asset is missing, rather than
    // leaving the announcement with no image at all.
    if (fs.existsSync(nuke)) return nuke;
    console.error(`Turn banner: nuke plate missing from ${TURN_BANNER_DIR}`);
  }
  // And after the Rite of Ascension there is no sky at all, only the fire.
  // Same shape, same fall-through: a missing asset costs the guild its banner,
  // never its turn announcement.
  if (state?.game?.ascensionFiredTurn != null) {
    const hellfire = path.join(TURN_BANNER_DIR, "hellfire.jpg");
    if (fs.existsSync(hellfire)) return hellfire;
    console.error(`Turn banner: hellfire plate missing from ${TURN_BANNER_DIR}`);
  }
  if (!turn?.phase) return null;
  // A null banner is not "no picture" — it is a Turn row written before this
  // column existed, or by a path that forgot to set it. Pick one on the spot so
  // Turn 1 of a game never posts bare.
  const file = turn.banner ?? pickTurnBanner(turn.phase);
  const full = path.join(TURN_BANNER_DIR, file);
  return fs.existsSync(full) ? full : null;
}

module.exports = {
  TURN_BANNER_DIR,
  pickTurnBanner,
  nextTurnBanner,
  turnBannerPath,
};
