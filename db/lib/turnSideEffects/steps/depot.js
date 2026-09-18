const { ambientLine } = require("../../ambientLine");
const { refreshLiveRooms } = require("../../syncZones");
const { postMessage } = require("../../discordRest");

// The Depot speaking for itself: the train coming in and going out again are
// things the room witnesses, whoever was or wasn't there to see it.
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

  // The Railyard's starter message says whether the train is at the platform
  // (db/lib/roomLive.js), and the parity flips on every close, so this repaints
  // every turn. Hash-guarded, so a turn that did not move it edits nothing.
  if (p.depotLocationId) {
    await step("trainRefresh", () =>
      refreshLiveRooms(prisma, "train").catch((err) =>
        console.error("Railyard refresh failed:", err.message),
      ),
    );
  }
}

module.exports = { runDepotLines };
