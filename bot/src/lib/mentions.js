const { prisma, buildNarrowcastContext, computeNarrowcastAccess, NARROWCAST_SLUGS } = require("@lifeweb/db");
const { sendDm } = require("./dm");
const { pushToUser } = require("@lifeweb/db/lib/webPush");

// Character-role mentions: who was pinged, may they hear it, and (in a private thread) letting
// them in. Character.discordRoleId is @unique, so a mentioned role resolves to one character.

// A ping must not carry further than a voice would: Location gates on location, zone's #summary
// on zone, special channels on db/lib/specialChannels.js.
async function canHearPing(character, context) {
  if (NARROWCAST_SLUGS.includes(context.channelKind)) {
    const ctx = await buildNarrowcastContext(prisma, character.id);
    return Boolean(computeNarrowcastAccess(ctx)[context.channelKind]?.view);
  }
  if (context.locationId) return character.locationId === context.locationId;
  if (context.zoneId) return character.zoneId === context.zoneId;
  return false;
}

// The ALIVE characters behind the roles mentioned. Read before proxying deletes the original
// (bot/src/lib/proxy.js). Self-pings DO relay — the proxy already suppresses the ping itself
// (PROXYING.md §2).
async function resolveMentionedCharacters(roleIds) {
  if (roleIds.length === 0) return [];
  return prisma.character.findMany({
    where: { discordRoleId: { in: roleIds }, status: "ALIVE" },
  });
}

function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// Carries where and a link, never the message text — a private thread the target hasn't joined
// would otherwise leak its content. `placeKey` rides in meta so /chat can open the place.
async function notifyMentioned(client, character, context, link, { placeKey = null } = {}) {
  const place = context.locationName ?? context.zoneName ?? null;
  const nowhere = context.channelKind ? `#${context.channelKind}` : "somewhere"; // special channel has no place
  const where = context.threadName
    ? `${place ?? "somewhere"} · ${context.threadName}`
    : (place ?? nowhere);

  const user = await client.users.fetch(character.discordUserId).catch(() => null);
  if (!user) return;
  await sendDm(user, `» *You were mentioned in ${where}.*\n${link}`, {
    source: "mention",
    meta: { placeKey, where },
  }).catch(() => {});
  await pushToUser(prisma, character.discordUserId, { // browser notification, after the DM, never affects it
    title: `${character.name} was named`,
    body: `in ${where}`,
    url: placeKey ? `/chat#${encodeURIComponent(placeKey)}` : "/chat",
  }).catch(() => {});
}

module.exports = {
  canHearPing,
  messageLink,
  notifyMentioned,
  resolveMentionedCharacters,
};
