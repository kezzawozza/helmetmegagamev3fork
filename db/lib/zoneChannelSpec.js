// The complete intended Discord layout for one Zone and for one Location —
// the single description both first-time provisioning and the every-run
// reconcile build from, so the two can never disagree.
//
// Every target states its own privacy in full — nothing is inherited from
// the category, because Discord's category "sync" is a one-time copy at
// creation that drifts independently afterwards.
//
// The @everyone VIEW_CHANNEL deny is the entire mechanism that makes a
// channel private; every other overwrite here is an allow layered on top of
// it. Since Bascinet 2 a zone carries only its category and #summary (opened
// by the "Zone: X" role); every Location has its own text channel, and its
// Rooms are threads under it that the bot alone may create.
//
// A Location channel is opened by a PER-MEMBER overwrite, not by a
// "Location: X" role. 56 locations would have cost 56 of the guild's 250
// roles, on top of one personal role per living character; Discord allows
// 1000 overwrites per channel instead, which this game cannot reach.
// LOCATION_MEMBER_ALLOW below is the bit set that used to sit on the role,
// now handed to one member at a time by applyLocationMoveSideEffects.
const { spectatorOverwrite } = require("./spectatorAccess");
const { ghostOverwrite } = require("./ghostAccess");

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

// The 5-minute slowmode on #summary — the channel is for abstracted,
// big-picture beats, and the slowmode is what keeps it from becoming a second
// moment-to-moment channel.
const SUMMARY_SLOWMODE_SECONDS = 300;

const SUMMARY_TOPIC =
  "What did people in your zone see your character do over the last day? Abstracted, big-picture play.";

// Discord caps a channel topic at 1024 characters.
const TOPIC_MAX = 1024;

// GM gets an explicit overwrite on every channel (not just the category) so
// it can't be clawed back by a channel-level @everyone deny — Discord
// resolves channel overwrites after category ones, and a role with no entry
// of its own falls through to whatever @everyone says there.
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

// Layers a channel's own bits onto the shared base for a target that already
// appears in it, rather than appending a second entry for the same id —
// Discord allows exactly one overwrite per target, and a duplicate would
// silently win or lose depending on ordering.
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

// The global GM roles — Gamemaster and Trial Gamemaster — deliberately do NOT
// appear on ZONE-SCOPED channels. A GM used to hold a blanket
// grant on all 56 Location channels at once, which is exactly the "a bit
// overwhelming" this replaced: a zone's category, #summary and Locations now
// grant that ZONE's own "GM: <Zone>" role instead, and a GM holds the ones
// they picked (db/lib/gmZoneRoles.js). The global roles keep their blanket
// grant on everything that is not a zone — #turns, the narrowcast channels,
// the report channel — because none of those belong to one place.

// The overwrites EVERY zone-scoped target carries: @everyone's deny (the
// privacy mechanism), the zone's GM seat, the spectator seat, the ghost seat.
// `spectators` is whether the spectator seat may VIEW right now — the game's
// phase decides (db/lib/spectatorAccess.js), and every caller reads it once
// and passes it down, so a spec never has to know about the database.
function baseOverwrites(guildId, zoneGmRoleId, { spectators = true } = {}) {
  return [
    { id: guildId, type: 0, deny: (PERM_VIEW_CHANNEL | PERM_ATTACH_FILES).toString() },
    ...roleAllow(zoneGmRoleId, PERM_VIEW_CHANNEL | PERM_ATTACH_FILES),
    ...spectatorOverwrite({ visible: spectators }),
    ...ghostOverwrite(),
  ];
}

// The intended layout for one zone, as create payloads minus parent_id
// (which only exists once the category has been made). Which keys are
// present depends on zone.kind:
//   SURFACE     { category, summary }
//   CAVE_GROUP  { category }
//   CAVE_LEVEL  { }   (its Location channels parent to the group's category)
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

// What one standing character is granted on the Location channel they are
// in: READ the street and talk inside its Room threads, but say nothing at
// top level and create no thread of either kind — the bot spawns every Room
// and every Conversation, which is what keeps PlayerThread a complete
// record.
//
// Send came off the top level on 2026-09-06 (Chat's decision 5, and
// CHANNELS.md §2). A Location channel is the street's SCENERY now — arrivals,
// smells, the turret, the noticeboard, the turn line — and talk belongs in a
// Room thread, a Conversation or the zone summary, all of which are a scene
// somebody chose to be in. The web face agrees: /chat draws no composer on a
// Location.
//
// But taking a bit OUT OF AN ALLOW DENIES NOTHING. Discord resolves a channel
// from the guild-level @everyone permissions first, and @everyone carries Send
// Messages guild-wide, so for two days every occupant of every Location channel
// could still type there — unproxied and unarchived, under their real Discord
// name, because isDesignatedTupperChannel had stopped watching the channel. The
// deny that actually carries the rule is on @everyone in locationChannelSpec
// below, the same shape #turns, the spectator seat and the ghost seat all use.
//
// One `npm run db:doctor -- --apply` rewrites every existing occupant's
// overwrite to this bit set; the occupancy check compares the allow bits, not
// just the presence of a target.
const LOCATION_MEMBER_ALLOW = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES_IN_THREADS | PERM_ADD_REACTIONS;

// The text channel for one Location. It names no location role: the spec is
// the channel's STANDING shape, and who is standing here changes every turn.
// Occupant overwrites are written by the move pipeline and reconciled by the
// channel doctor's occupancy check — never by this spec, which is exactly
// why managedOverwriteIds() must never learn to delete a member target.
//
// The @everyone deny is what makes the street quiet. SEND_MESSAGES governs the
// top level only — SEND_MESSAGES_IN_THREADS is a separate bit, so a Room thread
// under this channel still takes an occupant's words. The GM: <Zone> allow
// above outranks it (Discord applies role allows after the @everyone deny), so
// a GM still types here; the bot bypasses overwrites outright, which is why the
// arrivals and the turn line keep landing.
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

// The names the roles wear, and the signatures the doctor and
// prune-orphan-roles match on — "Zone: Town", "Location: Square".
function zoneRoleName(zone) {
  return `Zone: ${zone.name}`;
}

// The GM seat for one zone. A GM holds these for the zones they picked, and
// they — not the global Gamemaster role — are what opens the zone's channels
// (db/lib/gmZoneRoles.js). Named with the same "<kind>: <name>" signature as
// the access role above, so the doctor and prune-orphan-roles can recognise
// one on sight.
function zoneGmRoleName(zone) {
  return `GM: ${zone.name}`;
}

module.exports = {
  zoneChannelSpec,
  locationChannelSpec,
  zoneRoleName,
  zoneGmRoleName,
  LOCATION_MEMBER_ALLOW,
};
