require("dotenv").config();
const path = require("node:path");
const fs = require("node:fs");
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// Stay alive rather than let Node kill the process — a crash loop replays `ready`'s catch-up burst
// fast enough to trip Discord's Cloudflare IP ban (db/lib/discordRest.js's breaker too).
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (staying alive):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (staying alive):", err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping, // feeds Chat's "X is typing…" (CHAT.md §3)
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// One guard for every handler: names the failing event rather than rejecting silently up to the catch-all above.
function guard(event, args) {
  return Promise.resolve()
    .then(() => event.execute(...args))
    .catch((err) => console.error(`${event.name} handler failed:`, err));
}

const eventsDir = path.join(__dirname, "events");
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith(".js"))) {
  const event = require(path.join(eventsDir, file));
  if (event.once) {
    client.once(event.name, (...args) => guard(event, args));
  } else {
    client.on(event.name, (...args) => guard(event, args));
  }
}

client.login(process.env.DISCORD_TOKEN);
