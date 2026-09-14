const { ambientLine } = require("../../ambientLine");
const { refreshLiveRooms } = require("../../syncZones");
const { postMessage } = require("../../discordRest");

// The Depot's hardware, speaking for itself: the generator dying and the
// shuttle leaving on its own clock are both things the room witnesses.
async function runDepotLines({ prisma, p, list, step }) {
  if (p.depotLocationId && list(p.depotLines).length) {
    const depotLocation = await prisma.location
      .findUnique({
        where: { id: p.depotLocationId },
        select: { discordChannelId: true },
      })
      .catch(() => null);
    if (depotLocation?.discordChannelId) {
      const depotLines = list(p.depotLines);
  for (let i = 0; i < depotLines.length; i += 1) {
        const line = depotLines[i];
        await step(`depotLine:${i}`, () =>
          postMessage(
            depotLocation.discordChannelId,
            ambientLine(line.text, [], { signed: line.signed }),
          ).catch((err) => console.error("Depot ambient line failed:", err)),
        );
      }
    }
  }

  // The Landing Pad's starter message says whether the shuttle is sitting on
  // it (db/lib/roomLive.js), and the shuttle may have left on its own clock
  // this turn. Hash-guarded, so a turn that did not move it edits nothing.
  if (p.depotLocationId) {
    await step("shuttleRefresh", () =>
      refreshLiveRooms(prisma, "shuttle").catch((err) =>
        console.error("Landing pad refresh failed:", err.message),
      ),
    );
  }
}

module.exports = { runDepotLines };
