// The complete intended Discord layout for one Zone and Location, so provisioning and reconcile
// can never disagree. A Location channel opens by a PER-MEMBER overwrite, not a role (LOCATION_MEMBER_ALLOW).
const { spectatorOverwrite } = require("./spectatorAccess");

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ADD_REACTIONS = 64n;
const PERM_ATTACH_FILES = 32768n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_MANAGE_THREADS = 17179869184n;
const PERM_CREATE_PUBLIC_THREADS = 34359738368n;
const PERM_CREATE_PRIVATE_THREADS = 68719476736n;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944n;

// Keeps #summary from becoming a moment-to-moment channel.
const SUMMARY_SLOWMODE_SECONDS = 300;

const SUMMARY_TOPIC =
  "What did people in your zone see your character do over the last day? Abstracted, big-picture play.";

// Discord caps a channel topic at 1024 characters.
const TOPIC_MAX = 1024;

// GM gets an explicit overwrite on every channel, not just the category — no entry falls through to @everyone.
const GM_SUMMARY_PERMS =
  PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_MANAGE_MESSAGES + PERM_ATTACH_FILES;
const GM_LOCATION_PERMS =
  PERM_VIEW_CHANNEL +
  PERM_SEND_MESSAGES +
  PERM_CREATE_PUBLIC_THREADS +
  PERM_CREATE_PRIVATE_THREADS +
  PERM_SEND_MESSAGES_IN_THREADS +
  PERM_MANAGE_THREADS +
  PERM_MANAGE_MESSAGES +
  PERM_ATTACH_FILES;

// Layers bits onto an existing target's overwrite rather than duplicating it — Discord allows only one per target.
function mergeOverwrite(base, extra) {
  const merged = base.map((o) => ({ ...o }));
  const existing = merged.find((o) => o.id === extra.id);
  if (!existing) return [...merged, extra];
  existing.allow = String(BigInt(existing.allow ?? "0") | BigInt(extra.allow ?? "0"));
  existing.deny = String(BigInt(existing.deny ?? "0") | BigInt(extra.deny ?? "0"));
  return merged;
}

function roleAllow(roleId, allow) {
  return roleId ? [{ id: roleId, type: 0, allow: allow.toString() }] : [];
}

// Global GM roles deliberately do NOT appear on ZONE-SCOPED channels — the zone's own "GM: <Zone>" role does that (db/lib/gmZoneRoles.js).
// Overwrites EVERY zone-scoped target carries; `spectators` per db/lib/spectatorAccess.js, so a spec never has to know about the database.
function baseOverwrites(guildId, zoneGmRoleId, { spectators = true } = {}) {
  return [
    { id: guildId, type: 0, deny: (PERM_VIEW_CHANNEL | PERM_ATTACH_FILES).toString() },
    ...roleAllow(zoneGmRoleId, PERM_VIEW_CHANNEL | PERM_ATTACH_FILES),
    ...spectatorOverwrite({ visible: spectators }),
  ];
}

// Intended layout for one zone. Keys by zone.kind: SURFACE {category,summary}, CAVE_GROUP {category}, CAVE_LEVEL {}.
function zoneChannelSpec(zone, { spectators = true } = {}) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const zoneGmRoleId = zone.gmRoleId ?? null;
  const base = baseOverwrites(guildId, zoneGmRoleId, { spectators });
  const zoneRoleId = zone.discordRoleId ?? null;

  if (zone.kind === "CAVE_LEVEL") return {};

  const category = { name: zone.name, type: CHANNEL_TYPE_CATEGORY, permission_overwrites: base };
  if (zone.kind === "CAVE_GROUP") return { category };

  return {
    category,
    summary: {
      name: "summary",
      type: CHANNEL_TYPE_TEXT,
      rate_limit_per_user: SUMMARY_SLOWMODE_SECONDS,
      topic: SUMMARY_TOPIC,
      permission_overwrites: [
        ...roleAllow(zoneGmRoleId, GM_SUMMARY_PERMS),
        ...roleAllow(
          zoneRoleId,
          PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ADD_REACTIONS,
        ),
      ].reduce(mergeOverwrite, base),
    },
  };
}

// What a standing character is granted: READ the street, talk in Room threads,
// nothing at top level (CHANNELS.md §2). Taking a bit OUT OF AN ALLOW DENIES NOTHING —
// the top-level send deny is on @everyone in locationChannelSpec below.
const LOCATION_MEMBER_ALLOW = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES_IN_THREADS | PERM_ADD_REACTIONS;

// What a WATCHING character is granted: the view and nothing else
// (db/lib/vantages.js). A Location you walked into this turn but have since
// left stays open to you read-only. Presence is what gives you a voice.
const LOCATION_VANTAGE_ALLOW = PERM_VIEW_CHANNEL;

// ...and what the same overwrite takes away. Leaving a bit out of the allow is
// not enough here: the guild's @everyone role grants SEND_MESSAGES_IN_THREADS
// and ADD_REACTIONS, and the channel's @everyone overwrite denies neither, so a
// watcher handed only VIEW could still talk in the Room threads and react.
const LOCATION_VANTAGE_DENY = PERM_SEND_MESSAGES | PERM_SEND_MESSAGES_IN_THREADS | PERM_ADD_REACTIONS;

// The text channel for one Location: its STANDING shape, never occupancy —
// managedOverwriteIds() must never learn to delete a member target.
function locationChannelSpec(location, zoneGmRoleId = null, { spectators = true } = {}) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const base = baseOverwrites(guildId, zoneGmRoleId, { spectators });
  const topic = (location.description || "").replace(/\s*\n+\s*/g, " ").trim().slice(0, TOPIC_MAX);

  return {
    name: location.slug,
    type: CHANNEL_TYPE_TEXT,
    topic,
    permission_overwrites: [
      ...roleAllow(zoneGmRoleId, GM_LOCATION_PERMS),
      {
        id: guildId,
        type: 0,
        deny: (
          PERM_SEND_MESSAGES |
          PERM_CREATE_PUBLIC_THREADS |
          PERM_CREATE_PRIVATE_THREADS
        ).toString(),
      },
    ].reduce(mergeOverwrite, base),
  };
}

function zoneRoleName(zone) {
  return `Zone: ${zone.name}`;
}

function zoneGmRoleName(zone) {
  return `GM: ${zone.name}`;
}

// A cave level has no GM seat of its own — its Locations wear the group's,
// the same indirection Zone.seatZoneId makes. The one definition; the old
// destructive zones sync, the channel doctor and the Discord mirror all
// called this out separately before, and the three copies could (and once
// did, briefly) disagree.
function gmRoleIdFor(zone, zoneById) {
  if (!zone) return null;
  return zone.gmRoleId ?? (zone.parentZoneId ? zoneById.get(zone.parentZoneId)?.gmRoleId ?? null : null);
}

module.exports = {
  zoneChannelSpec,
  locationChannelSpec,
  zoneRoleName,
  zoneGmRoleName,
  gmRoleIdFor,
  LOCATION_MEMBER_ALLOW,
  LOCATION_VANTAGE_ALLOW,
  LOCATION_VANTAGE_DENY,
};
