const { deleteChannelOverwrite } = require("../../discordRest");
const { expireVantages } = require("../../vantages");
const { notifyPresence } = require("../../presenceNotify");

// The turn shift puts every light out (db/lib/vantages.js). A character keeps
// watching the streets they walked through, and the new day is one of the two
// things that ends that — the other is leaving the zone, which the move itself
// handles.
//
// FIRST in the thunk, ahead of applyRelocations and runXomOutcomes: those move
// people, and a move can light a vantage of its own. `keepTurnId` is the turn
// that has just opened, so anything lit by this very push survives and
// everything from the day before goes. That makes the step order-independent
// rather than merely lucky.
//
// Not the only thing that closes these channels: a stale row is invalid to
// every reader the moment the turn number changes, and the channel doctor's
// location-occupancy sweep — which runs at the end of this same thunk — takes
// the overwrite off anything left behind. This step is what makes it prompt.
async function expireTurnVantages({ prisma, p, step }) {
  await step("vantages", async () => {
    const rows = await expireVantages(prisma, { keepTurnId: p.newTurnId ?? null });
    if (rows.length === 0) return;

    const touched = new Set();
    for (const row of rows) {
      touched.add(row.characterId);
      const character = row.character;
      // A dead or departed character has already had every overwrite in the
      // game stripped (db/lib/accessSweep.js), and a non-mirrored one never held
      // any; either way the call would only be a 404 against the rate limit.
      if (!character?.discordUserId || !character.discordMirrored) continue;
      if (character.status !== "ALIVE") continue;
      if (!row.location?.discordChannelId) continue;
      await deleteChannelOverwrite(row.location.discordChannelId, character.discordUserId).catch((err) =>
        console.error(
          `Vantage expiry: failed to close ${row.location.discordChannelId} to ${character.discordUserId}:`,
          err.message ?? err,
        ),
      );
    }

    // The web's half: every open Chat tab re-asks placesFor and the Elsewhere
    // section empties itself, with nobody reloading anything (CHAT.md §3).
    for (const characterId of touched) {
      await notifyPresence(prisma, characterId);
    }
  });
}

module.exports = { expireTurnVantages };
