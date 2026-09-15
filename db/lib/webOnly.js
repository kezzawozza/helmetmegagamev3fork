// Shim for one deploy — the switch moved (and inverted polarity) to
// db/lib/discordMirroring.js. Delete this file once nothing requires it.
const { setDiscordMirrored } = require("./discordMirroring");

module.exports = { setWebOnly: (prisma, character, on) => setDiscordMirrored(prisma, character, !on) };
