// Which picture #turns posts above a turn announcement. Picked when the turn
// opens and remembered on the Turn row, not re-rolled at post time, since the
// announcement gets REPOSTED (cold-start console rebuild, wipe finisher).
const fs = require("node:fs");
const path = require("node:path");
const { docsPath } = require("./repoPaths");

// null when docs/ can't be found (treat as "no banner"); guard every join,
// since path.join(null, ...) throws and would take down the whole announcement.
const TURN_BANNER_DIR = docsPath("assets", "turn");

const PLATES_PER_PHASE = 4;

function platesFor(phase) {
  const stem = phase === "DUSK" ? "dusk" : "dawn";
  return Array.from({ length: PLATES_PER_PHASE }, (_, i) => `${stem}-${i + 1}.jpg`);
}

// Avoids the previous turn OF THE SAME PHASE (turns alternate DAWN/DUSK).
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

// Reads the last same-phase banner and picks a different one.
async function nextTurnBanner(prisma, phase) {
  return pickTurnBanner(phase, await lastBannerForPhase(prisma, phase));
}

// Resolves a Turn to a file on disk; null means nothing to post — a missing
// asset must never cost the guild its turn announcement. `state` is optional.
// THE STAMPS COME OFF `state.game`, NOT GameState itself — the Game row is
// created fresh by the wipe so it cannot lie about which game ended. Callers
// select `{ game: { select: { nukeDetonatedTurn, ascensionFiredTurn } } }`.
function turnBannerPath(turn, state = null) {
  if (!TURN_BANNER_DIR) return null;
  if (state?.game?.nukeDetonatedTurn != null) {
    const nuke = path.join(TURN_BANNER_DIR, "nuke.jpg");
    if (fs.existsSync(nuke)) return nuke;
    console.error(`Turn banner: nuke plate missing from ${TURN_BANNER_DIR}`);
  }
  // After the Rite of Ascension there is no sky at all, only the fire.
  if (state?.game?.ascensionFiredTurn != null) {
    const hellfire = path.join(TURN_BANNER_DIR, "hellfire.jpg");
    if (fs.existsSync(hellfire)) return hellfire;
    console.error(`Turn banner: hellfire plate missing from ${TURN_BANNER_DIR}`);
  }
  if (!turn?.phase) return null;
  // A null banner is a Turn row written before this column existed; pick one
  // on the spot so Turn 1 of a game never posts bare.
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
