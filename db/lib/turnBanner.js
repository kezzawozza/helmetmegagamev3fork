// Which picture #turns posts above a turn announcement. Picked when the turn
// opens and remembered on the Turn row, not re-rolled at post time, since the
// announcement gets REPOSTED (cold-start console rebuild, wipe finisher).
const fs = require("node:fs");
const path = require("node:path");
const { docsPath } = require("./repoPaths");

// null when docs/ can't be found (treat as "no banner"); guard every join,
// since path.join(null, ...) throws and would take down the whole announcement.
const TURN_BANNER_DIR = docsPath("assets", "turn");

// All eight plates, one pool. They were four Dawn and four Dusk, picked by the turn's phase; with no phases left they are
// simply eight pictures of Ravenheart. The FILENAMES stay as they are — docs/assets/make-turn-banners.js builds them from
// named source plates, and renaming them would cost a rebuild for nothing.
const PLATES = ["dawn-1.jpg", "dawn-2.jpg", "dawn-3.jpg", "dawn-4.jpg", "dusk-1.jpg", "dusk-2.jpg", "dusk-3.jpg", "dusk-4.jpg"];

// Avoids the plate the previous turn used. It used to avoid the previous turn of the same PHASE, which was the same idea
// against a pool of four.
function pickTurnBanner(previousBanner = null) {
  const pool = PLATES.filter((p) => p !== previousBanner);
  const from = pool.length ? pool : PLATES;
  return from[Math.floor(Math.random() * from.length)];
}

// The banner the previous turn used, or null if there wasn't one.
async function lastBanner(prisma) {
  const previous = await prisma.turn.findFirst({
    orderBy: { number: "desc" },
    select: { banner: true },
  });
  return previous?.banner ?? null;
}

// Reads the last banner and picks a different one.
async function nextTurnBanner(prisma) {
  return pickTurnBanner(await lastBanner(prisma));
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
  if (!turn) return null;
  // A null banner is a Turn row written before this column existed; pick one
  // on the spot so Turn 1 of a game never posts bare.
  const file = turn.banner ?? pickTurnBanner();
  const full = path.join(TURN_BANNER_DIR, file);
  return fs.existsSync(full) ? full : null;
}

module.exports = {
  TURN_BANNER_DIR,
  pickTurnBanner,
  nextTurnBanner,
  turnBannerPath,
};
