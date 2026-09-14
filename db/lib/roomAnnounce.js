// One line in a Room's thread saying somebody did something to its stash, aliased like the whisper poll aliases a speaker — "An old woman leaves Graga Sac ×3 here." The room learns an age and a presentation, never a name (docs/systemdocs/CARRY.md).
// REST, best-effort, catch-logged: a missed line is flavour lost, never a failed transfer. Never call this inside a transaction.
const { postMessage } = require("./discordRest");
const { aliasSubject } = require("./concealedIdentity");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

async function announceInRoom(room, character, text, lines = []) {
  if (!room?.discordThreadId) return;
  const said = `${aliasSubject(character)} ${text}`;
  const content = ambientLine(said, lines);
  await postMessage(room.discordThreadId, content).catch((err) =>
    console.error(`Room stash announcement failed (${room.name ?? room.discordThreadId}):`, err.message),
  );

  if (!room.id) return;
  const { prisma } = require("../index");
  await sceneLineAt(prisma, { roomId: room.id, text: said, lines });
}

module.exports = { announceInRoom };
