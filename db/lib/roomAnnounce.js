// One line in a Room's thread saying somebody did something to its stash — "Ada leaves Graga Sac ×3 here." The room is told the PRESENTED name: your own, a forced name, or "An old woman" when concealed (docs/systemdocs/CARRY.md).
// REST, best-effort, catch-logged: a missed line is flavour lost, never a failed transfer. Never call this inside a transaction.
const { postMessage } = require("./discordRest");
const { aliasSubject } = require("./concealedIdentity");
const { loadForcedName, loadConcealment, presentedIdentity } = require("./presentedIdentity");
const { ambientLine } = require("./ambientLine");
const { sceneLineAt } = require("./scene");

// Same choice as shout.js#shouterNameFor. Any failure reads as concealed — errs toward hiding.
async function subjectFor(prisma, character) {
  if (!character?.id) return aliasSubject(character ?? {});
  try {
    const row = await prisma.character.findUnique({
      where: { id: character.id },
      select: { id: true, name: true, age: true, gender: true, concealed: true },
    });
    if (!row) return aliasSubject(character);
    const [forcedName, concealment] = await Promise.all([
      loadForcedName(prisma, row.id),
      loadConcealment(prisma, row.id),
    ]);
    const identity = presentedIdentity(row, { forcedName, concealment });
    return identity.concealed ? aliasSubject(row) : identity.name || aliasSubject(row);
  } catch (err) {
    console.error(`Room stash identity lookup failed (${character.id}):`, err.message);
    return aliasSubject(character);
  }
}

async function announceInRoom(room, character, text, lines = []) {
  if (!room?.discordThreadId) return;
  const { prisma } = require("../index");
  const said = `${await subjectFor(prisma, character)} ${text}`;
  const content = ambientLine(said, lines);
  await postMessage(room.discordThreadId, content).catch((err) =>
    console.error(`Room stash announcement failed (${room.name ?? room.discordThreadId}):`, err.message),
  );

  if (!room.id) return;
  await sceneLineAt(prisma, { roomId: room.id, text: said, lines });
}

module.exports = { announceInRoom };
