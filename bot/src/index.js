require("dotenv").config();
const path = require("node:path");
const fs = require("node:fs");
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// Doubling backoff for a flaky login, same shape as bot/src/lib/feedOutbox.js's reconnect.
const LOGIN_BACKOFF_MIN_MS = 1000;
const LOGIN_BACKOFF_MAX_MS = 60_000;

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

// client.login() rejects on a bad connect (e.g. Discord itself returning a 503 on the initial
// handshake), and discord.js's own catch nulls the REST token on its way out — Client#destroy()
// does `this.token = null; this.rest.setToken(null)`. Left alone the process just sits there,
// logged in nowhere, retrying nothing. Retry it ourselves instead.
let loginBackoffMs = LOGIN_BACKOFF_MIN_MS;
function attemptLogin() {
  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error(`Login failed, retrying in ${loginBackoffMs}ms:`, err);
    setTimeout(attemptLogin, loginBackoffMs).unref?.();
    loginBackoffMs = Math.min(loginBackoffMs * 2, LOGIN_BACKOFF_MAX_MS);
  });
}
attemptLogin();

// Rare race, seen once in production: discord.js's internal shard manager can finish a stray
// reconnect *after* a failed login() already nulled the REST token above, firing `ready` on a
// client whose REST side can never send anything again — gateway alive, every send failing with
// "Expected token to be set for this request, but none was present". Nothing in this process can
// repair that internal state, so once we've been ready at least once, treat a missing token as
// fatal and let Railway restart the container clean. Narrower than the "stay alive" policy above
// on purpose — this fires only on this one confirmed-broken condition, not on ordinary errors, so
// it can't become the crash loop that policy exists to avoid.
client.once("ready", () => {
  loginBackoffMs = LOGIN_BACKOFF_MIN_MS;
  const watchdog = setInterval(
    () => {
      if (!client.token) {
        console.error("REST token missing on a client that already logged in once — exiting for a clean restart.");
        clearInterval(watchdog);
        process.exit(1);
      }
    },
    5 * 60 * 1000,
  );
  watchdog.unref?.();
});
