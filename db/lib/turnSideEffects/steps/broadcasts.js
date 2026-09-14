const { broadcastToZones } = require("../../worldBroadcast");
const { postGameEnded } = require("../../gameEnd");
const { syncSpectatorAccess } = require("../../spectatorAccess");

async function runBroadcasts({ prisma, p, step }) {
  // The fireball, into every zone's #summary. Last of the announcements and
  // after the deaths above, so nobody reads that the sky is on fire before
  // their own character has actually died. It carries a real @everyone —
  // the one message in the game that should wake somebody who is asleep.
  if (p.nukeBroadcast) {
    await step("nukeBroadcast", async () => {
      const { sent, failed } = await broadcastToZones(prisma, p.nukeBroadcast.content, {
        mentionEveryone: p.nukeBroadcast.mentionEveryone,
      }).catch((err) => {
        console.error("Nuke broadcast failed:", err);
        return { sent: 0, failed: [] };
      });
      console.log(`Nuke broadcast: ${sent} zones, ${failed.length} failed.`);
    });
  }

  // The hellfire, same fan-out, no @everyone: the town was warned two turns
  // ago and that was the message worth waking somebody for.
  if (p.ascensionBroadcast) {
    await step("ascensionBroadcast", async () => {
      const { sent, failed } = await broadcastToZones(
        prisma,
        p.ascensionBroadcast.content,
      ).catch((err) => {
        console.error("Ascension broadcast failed:", err);
        return { sent: 0, failed: [] };
      });
      console.log(`Ascension broadcast: ${sent} zones, ${failed.length} failed.`);
    });
  }

  // The reveal, after the sky and before anything else — the game is over.
  if (p.gameEndedPost) {
    await step("gameEnded", () =>
      postGameEnded(prisma, p.gameEndedPost).catch((err) =>
        console.error("Game Ended post failed:", err),
      ),
    );
    // A phase change, so the spectator seat is re-checked like any other.
    await step("spectatorSweep", () =>
      syncSpectatorAccess(prisma).catch((err) =>
        console.error("Spectator sweep failed:", err),
      ),
    );
  }
}

module.exports = { runBroadcasts };
