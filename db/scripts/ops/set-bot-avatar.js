// Manual push of docs/assets/bot-icon.png to the bot's Discord avatar
// (`npm run db:set-bot-avatar`). Discord takes it as a base64 data URI on the
// JSON body of PATCH /users/@me, NOT a multipart upload (that's attachments —
// postAttachment in db/lib/discordRest.js), PNG/JPEG/GIF only. No prisma/DB
// dependency: the avatar is Discord-side state with nothing mirrored locally.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { discordRequest } = require("../../lib/discordRest");

const ICON_PATH = path.join(__dirname, "..", "..", "docs", "assets", "bot-icon.png");

async function main() {
  if (!fs.existsSync(ICON_PATH)) throw new Error(`Missing icon: ${ICON_PATH}`);

  const dataUri = `data:image/png;base64,${fs.readFileSync(ICON_PATH).toString("base64")}`;
  const before = await discordRequest("/users/@me");
  console.log(`Bot: ${before.username} (avatar ${before.avatar})`);

  const after = await discordRequest("/users/@me", { method: "PATCH", body: { avatar: dataUri } });
  console.log(`Done: avatar is now ${after.avatar}`);
  console.log(`  https://cdn.discordapp.com/avatars/${after.id}/${after.avatar}.png`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
