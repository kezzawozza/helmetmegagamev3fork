// Web Push: the browser notification a player gets when the page is closed. Lives in db/lib because BOTH faces send one. Takes `prisma` as a parameter for the same reason dm.js and turnAnnouncement.js do: requiring db/index.js back from inside db/lib would resolve to a partial exports object.
// NOTHING here ever throws — a notification is the least important thing in any call site it sits in, so every failure is swallowed and a bad subscription's row is deleted.
// UNCONFIGURED IS THE NORMAL CASE. Without VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT set, every function here is a no-op. See CHAT.md §5a and .env.example; generate a pair with `npx web-push generate-vapid-keys`.

const webpush = require("web-push");

let configured = null;

function vapid() {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    // A malformed key pair is a deploy problem, worth seeing in the log rather than as silence.
    console.error("Web Push: VAPID details rejected:", err);
    configured = false;
  }
  return configured;
}

// The public half, for the browser's `applicationServerKey`. Null when unconfigured.
function vapidPublicKey() {
  return vapid() ? process.env.VAPID_PUBLIC_KEY : null;
}

// `url` is a path on the web app, opened by the service worker's notificationclick.
async function pushToUser(prisma, discordUserId, { title, body, url } = {}) {
  if (!discordUserId) return { sent: 0, reason: "no-user" };
  if (!vapid()) return { sent: 0, reason: "unconfigured" };

  let rows = [];
  try {
    rows = await prisma.pushSubscription.findMany({ where: { discordUserId } });
  } catch (err) {
    console.error("Web Push: couldn't read subscriptions:", err);
    return { sent: 0, reason: "error" };
  }
  if (rows.length === 0) return { sent: 0, reason: "none" };

  const payload = JSON.stringify({ title: title ?? "", body: body ?? "", url: url ?? "/chat" });
  let sent = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
      );
      sent += 1;
      await prisma.pushSubscription
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    } catch (err) {
      // 404/410 is the push service saying this browser is gone for good; anything else is transient and the row stays.
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: row.id } }).catch(() => {});
      } else {
        console.error(`Web Push: send to ${discordUserId} failed (${status ?? "no status"})`);
      }
    }
  }
  return { sent };
}

module.exports = { pushToUser, vapidPublicKey };
