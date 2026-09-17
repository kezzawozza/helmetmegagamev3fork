// What the guild SHOULD look like, read straight off the database rows.
//
// Pure. It takes rows and returns plain objects — no Prisma, no REST, no clock.
// That is the whole point: the shape of the world is a function of the data, so
// it can be unit-tested, and so "is Discord right?" becomes a comparison rather
// than a script that walks off and fixes things as it goes.
//
// Every layout decision is borrowed, never re-derived. The zone category,
// #summary and Location channel come from db/lib/zoneChannelSpec.js; a Room
// thread's body and hash come from syncZones/bodies.js and shared.js; the two
// radio nets come from db/lib/specialChannels.js; Deadchat comes from
// db/lib/deadchat.js. If the mirror and the old sync ever disagree about what a
// channel should be called, that is a bug in one of those files, not here.
const {
  zoneChannelSpec,
  locationChannelSpec,
  zoneRoleName,
  zoneGmRoleName,
  gmRoleIdFor,
} = require("../zoneChannelSpec");
const { spectatorOverwrite } = require("../spectatorAccess");
const { SPECIAL_CHANNELS } = require("../specialChannels");
const { CATEGORY_NAME: RADIO_CATEGORY_NAME } = require("../syncSpecialChannels");
const {
  CHANNEL_NAME: DEADCHAT_CHANNEL_NAME,
  CATEGORY_NAME: DEADCHAT_CATEGORY_NAME,
  GM_ALLOW: DEADCHAT_GM_ALLOW,
  GM_DENY: DEADCHAT_GM_DENY,
} = require("../deadchat");
const { gmRoleIds } = require("../roleIds");
const { buildRoomBody, buildAnchorBody } = require("../syncZones/bodies");
const { locationAnchorRows } = require("../locationAnchorRow");
const { hashBody } = require("../syncZones/shared");
const { intendedPositions, LEVEL_CHANNEL_STRIDE } = require("../syncZones/ordering");
const { managedOverwriteIds } = require("../syncZones/parse");
const { CHANNEL_TYPE_TEXT, CHANNEL_TYPE_CATEGORY } = require("./live");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;

// The op-order bands the plan fixes. A band is carried on the desired object so
// diff.js never has to re-derive "roles come before channels" per target.
const ORDER = {
  ZONE_ROLE: 10,
  ZONE_GM_ROLE: 20,
  CATEGORY: 30,
  SUMMARY: 40,
  LOCATION_CHANNEL: 50,
  REPARENT: 60,
  POSITIONS: 70,
  PROPERTIES: 80,
  OVERWRITES: 90,
  ROOM_THREAD: 100,
  ANCHOR: 110,
  CHARACTER_ACCESS: 120,
  TURNS_ACCESS: 130,
};

function categoryKeyFor(zone, zoneById) {
  if (zone.kind === "CAVE_LEVEL") {
    const parent = zone.parentZoneId ? zoneById.get(zone.parentZoneId) : null;
    return parent ? `category:zone:${parent.id}` : null;
  }
  return `category:zone:${zone.id}`;
}

function categoryIdFor(zone, zoneById) {
  return (
    zone.discordCategoryId ??
    (zone.parentZoneId ? zoneById.get(zone.parentZoneId)?.discordCategoryId ?? null : null) ??
    null
  );
}

// The @everyone / GM / spectator floor every special channel and Deadchat sits
// on. Written out here rather than reached for, because those two provisioners
// each build it inline and the mirror has to describe both.
function outsideZoneOverwrites(guildId, { gmAllow, gmDeny, spectators }) {
  const rows = [
    {
      id: guildId,
      type: 0,
      deny: (PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES).toString(),
    },
  ];
  for (const gmRoleId of gmRoleIds()) {
    rows.push({ id: gmRoleId, type: 0, allow: gmAllow.toString(), deny: (gmDeny ?? 0n).toString() });
  }
  if (spectators !== undefined) rows.push(...spectatorOverwrite({ visible: spectators }));
  return rows;
}

// --- the builder -------------------------------------------------------
//
// `rows` is everything loaded up front by index.js:
//   zones, locations, rooms, config, spectators,
//   liveStates          Map<liveKey, state>        (db/lib/roomLive.js)
//   componentsByRoomId  Map<roomId, components[]>  (syncZones/roomThreads.js)
//
// The last two are passed in rather than fetched because both need prisma, and
// this module stays pure. A missing entry just means "no live line" / "no
// buttons", which is what an unadorned room has anyway.
function buildDesired({
  zones = [],
  locations = [],
  rooms = [],
  config = {},
  spectators = true,
  liveStates = new Map(),
  componentsByRoomId = new Map(),
  guildId,
} = {}) {
  // No default from process.env: this module stays pure, so the caller (index.js)
  // is the one place that touches the environment, and a test fixture is never
  // silently borrowing whatever guild the last test happened to set.
  if (!guildId) throw new Error("buildDesired needs a guildId");

  const targets = [];
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const locationsByZoneId = new Map();
  for (const location of [...locations].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const list = locationsByZoneId.get(location.zoneId);
    if (list) list.push(location);
    else locationsByZoneId.set(location.zoneId, [location]);
  }
  // Feed sync.js's own ordering math the same zones-with-locations shape it
  // builds itself, so a location's intended slot can never drift from what
  // the old destructive zones sync would have computed for the identical rows.
  const zonesWithLocations = zones.map((z) => ({ ...z, locations: locationsByZoneId.get(z.id) ?? [] }));
  const positionByChannelId = new Map(intendedPositions(zonesWithLocations).map((p) => [p.id, p.position]));
  // Read off the ROWS, not off anything this run might create. A zone role
  // born in this same pass writes its id to `zone.discordRoleId` only when its
  // own op runs (diff.js), after this map is already built — so the narrowcast
  // view grant below misses a role created in the same run it was created in.
  // Accepted rather than chased: the role exists by the run right after, and
  // splitting this into a role-ops-then-reload-zones pass buys one run's head
  // start at the cost of a second full desired build every time.
  const roleIdByZoneSlug = new Map(zones.filter((z) => z.discordRoleId).map((z) => [z.slug, z.discordRoleId]));
  // The overwrites the reconcile is allowed to DELETE when the spec stops
  // naming them: the GM roles, the spectator seat, and both zone role families.
  // Never a member id — every occupant of a Location channel is one of those
  // (CHANNELS.md 3), and sweeping them would empty the room.
  const managedIds = [
    ...managedOverwriteIds([
      ...zones.map((z) => z.discordRoleId),
      ...zones.map((z) => z.gmRoleId),
    ]),
  ];

  // --- zone roles ------------------------------------------------------
  //
  // One access role per PRESENCE zone. A CAVE_GROUP gets none, because nobody
  // stands in a group. A Location gets none either: 56 of them would have cost
  // 56 of the guild's 250 roles, so a Location channel opens by a per-member
  // overwrite instead.
  for (const zone of zones) {
    if (zone.kind !== "CAVE_GROUP") {
      targets.push({
        targetType: "role",
        kind: "zone-role",
        key: `role:zone:${zone.id}`,
        subject: { type: "zone", id: zone.id },
        label: `Zone: ${zone.name}`,
        name: zoneRoleName(zone),
        order: ORDER.ZONE_ROLE,
        spec: { name: zoneRoleName(zone), permissions: "0", color: 0, hoist: false, mentionable: false },
        currentId: zone.discordRoleId ?? null,
        idColumn: { model: "zone", id: zone.id, field: "discordRoleId" },
      });
    }
    // The GM seat, one per SEAT zone: the group has one (it owns the category),
    // the two levels do not.
    if (zone.kind !== "CAVE_LEVEL") {
      targets.push({
        targetType: "role",
        kind: "zone-gm-role",
        key: `role:gm:${zone.id}`,
        subject: { type: "zone", id: zone.id },
        label: `GM: ${zone.name}`,
        name: zoneGmRoleName(zone),
        order: ORDER.ZONE_GM_ROLE,
        spec: { name: zoneGmRoleName(zone), permissions: "0", color: 0, hoist: false, mentionable: false },
        currentId: zone.gmRoleId ?? null,
        idColumn: { model: "zone", id: zone.id, field: "gmRoleId" },
      });
    }
  }

  // --- zone categories and #summary ------------------------------------
  //
  // zoneChannelSpec keys by kind, so a CAVE_LEVEL returns {} and simply
  // contributes nothing here — the same rows the old sync skips.
  for (const zone of zones) {
    const spec = zoneChannelSpec(zone, { spectators });
    if (spec.category) {
      targets.push({
        targetType: "channel",
        kind: "zone-category",
        key: `category:zone:${zone.id}`,
        subject: { type: "zone", id: zone.id },
        label: zone.name,
        name: spec.category.name,
        discordType: CHANNEL_TYPE_CATEGORY,
        parentKey: null,
        order: ORDER.CATEGORY,
        spec: spec.category,
        overwrites: spec.category.permission_overwrites ?? [],
        currentId: zone.discordCategoryId ?? null,
        idColumn: { model: "zone", id: zone.id, field: "discordCategoryId" },
      });
    }
    if (spec.summary) {
      targets.push({
        targetType: "channel",
        kind: "zone-summary",
        key: `channel:summary:${zone.id}`,
        subject: { type: "zone", id: zone.id },
        label: `${zone.name} / #summary`,
        name: spec.summary.name,
        discordType: CHANNEL_TYPE_TEXT,
        parentKey: categoryKeyFor(zone, zoneById),
        parentId: categoryIdFor(zone, zoneById),
        order: ORDER.SUMMARY,
        spec: spec.summary,
        properties: { topic: spec.summary.topic ?? "", rate_limit_per_user: spec.summary.rate_limit_per_user },
        overwrites: spec.summary.permission_overwrites ?? [],
        currentId: zone.discordSummaryChannelId ?? null,
        idColumn: { model: "zone", id: zone.id, field: "discordSummaryChannelId" },
      });
    }
  }

  // --- Location channels -----------------------------------------------
  for (const location of [...locations].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const zone = zoneById.get(location.zoneId);
    const spec = locationChannelSpec(location, gmRoleIdFor(zone, zoneById), { spectators });
    targets.push({
      targetType: "channel",
      kind: "location-channel",
      key: `channel:location:${location.id}`,
      subject: { type: "location", id: location.id },
      label: `${zone?.name ?? "?"} / ${location.name}`,
      name: spec.name,
      discordType: CHANNEL_TYPE_TEXT,
      parentKey: zone ? categoryKeyFor(zone, zoneById) : null,
      parentId: zone ? categoryIdFor(zone, zoneById) : null,
      order: ORDER.LOCATION_CHANNEL,
      spec,
      // A Location channel's name IS reconciled by the mirror, unlike the old
      // sync, which never renamed anything. That is the point of Phase 2's
      // rename-with-a-confirm — but it is still only a PATCH, so the channel
      // keeps its id and its history.
      properties: { name: spec.name, topic: spec.topic ?? "" },
      overwrites: spec.permission_overwrites ?? [],
      currentId: location.discordChannelId ?? null,
      idColumn: { model: "location", id: location.id, field: "discordChannelId" },
      position: positionByChannelId.get(location.discordChannelId) ?? null,
    });
  }

  // --- the two radio nets ----------------------------------------------
  targets.push({
    targetType: "channel",
    kind: "special-category",
    key: "category:radio",
    subject: { type: "special", id: "radio" },
    label: RADIO_CATEGORY_NAME,
    name: RADIO_CATEGORY_NAME,
    discordType: CHANNEL_TYPE_CATEGORY,
    parentKey: null,
    order: ORDER.CATEGORY,
    spec: { name: RADIO_CATEGORY_NAME, type: CHANNEL_TYPE_CATEGORY },
    overwrites: [],
    currentId: config.radioCategoryId ?? null,
    idColumn: { model: "gameConfig", id: 1, field: "radioCategoryId" },
  });
  for (const entry of SPECIAL_CHANNELS) {
    targets.push({
      targetType: "channel",
      kind: "special-channel",
      key: `channel:special:${entry.slug}`,
      subject: { type: "special", id: entry.slug },
      label: `#${entry.slug}`,
      name: entry.slug,
      discordType: CHANNEL_TYPE_TEXT,
      parentKey: "category:radio",
      parentId: config.radioCategoryId ?? null,
      order: ORDER.LOCATION_CHANNEL,
      spec: { name: entry.slug, type: CHANNEL_TYPE_TEXT, topic: entry.topic },
      properties: {
        name: entry.slug,
        topic: entry.topic,
        ...(entry.slowmode !== undefined ? { rate_limit_per_user: entry.slowmode } : {}),
      },
      overwrites: [
        ...outsideZoneOverwrites(guildId, {
          gmAllow: PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES,
          gmDeny: 0n,
          spectators,
        }),
        // The static zone-role view grants syncSpecialChannels used to apply.
        // A zone dropped from `roleViewZones` goes deaf on its own: its role is
        // in the managed set below, so the reconcile deletes an overwrite the
        // spec no longer names.
        ...(entry.roleViewZones ?? [])
          .map((slug) => roleIdByZoneSlug.get(slug))
          .filter(Boolean)
          .map((roleId) => ({ id: roleId, type: 0, allow: PERM_VIEW_CHANNEL.toString(), deny: "0" })),
      ],
      currentId: config[entry.configKey] ?? null,
      idColumn: { model: "gameConfig", id: 1, field: entry.configKey },
    });
  }

  // --- Deadchat ---------------------------------------------------------
  //
  // Deliberately NO spectator overwrite: a spectator reading this room is the
  // full death list at a glance, which is the leak it was rebuilt to close.
  targets.push({
    targetType: "channel",
    kind: "deadchat-category",
    key: "category:deadchat",
    subject: { type: "deadchat", id: "category" },
    label: DEADCHAT_CATEGORY_NAME,
    name: DEADCHAT_CATEGORY_NAME,
    discordType: CHANNEL_TYPE_CATEGORY,
    parentKey: null,
    order: ORDER.CATEGORY,
    spec: { name: DEADCHAT_CATEGORY_NAME, type: CHANNEL_TYPE_CATEGORY },
    overwrites: [],
    currentId: config.deadchatCategoryId ?? null,
    idColumn: { model: "gameConfig", id: 1, field: "deadchatCategoryId" },
  });
  targets.push({
    targetType: "channel",
    kind: "deadchat-channel",
    key: "channel:deadchat",
    subject: { type: "deadchat", id: "channel" },
    label: `#${DEADCHAT_CHANNEL_NAME}`,
    name: DEADCHAT_CHANNEL_NAME,
    discordType: CHANNEL_TYPE_TEXT,
    parentKey: "category:deadchat",
    parentId: config.deadchatCategoryId ?? null,
    order: ORDER.LOCATION_CHANNEL,
    spec: { name: DEADCHAT_CHANNEL_NAME, type: CHANNEL_TYPE_TEXT },
    properties: { name: DEADCHAT_CHANNEL_NAME },
    overwrites: outsideZoneOverwrites(guildId, {
      gmAllow: DEADCHAT_GM_ALLOW,
      gmDeny: DEADCHAT_GM_DENY,
      spectators: undefined,
    }),
    currentId: config.deadchatChannelId ?? null,
    idColumn: { model: "gameConfig", id: 1, field: "deadchatChannelId" },
  });

  // --- Party chat -------------------------------------------------------
  //
  // The parent channel each party's private thread hangs off, under the
  // Gameplay category. The threads themselves are opened live by the escort
  // flow (db/lib/partyChat.js); the mirror only manages the parent.
  //
  // Deliberately NO spectator overwrite — the party thread names give away who
  // is with whom in a way #general does not.
  targets.push({
    targetType: "channel",
    kind: "party-category",
    key: "category:gameplay",
    subject: { type: "party", id: "category" },
    label: "Gameplay",
    name: "gameplay",
    discordType: CHANNEL_TYPE_CATEGORY,
    parentKey: null,
    order: ORDER.CATEGORY,
    spec: { name: "Gameplay", type: CHANNEL_TYPE_CATEGORY },
    overwrites: [],
    currentId: config.gameplayCategoryId ?? null,
    idColumn: { model: "gameConfig", id: 1, field: "gameplayCategoryId" },
  });
  targets.push({
    targetType: "channel",
    kind: "party-channel",
    key: "channel:party",
    subject: { type: "party", id: "channel" },
    label: "#party",
    name: "party",
    discordType: CHANNEL_TYPE_TEXT,
    parentKey: "category:gameplay",
    parentId: config.gameplayCategoryId ?? null,
    order: ORDER.LOCATION_CHANNEL,
    spec: { name: "party", type: CHANNEL_TYPE_TEXT },
    properties: { name: "party" },
    overwrites: outsideZoneOverwrites(guildId, {
      gmAllow: PERM_VIEW_CHANNEL,
      gmDeny: PERM_SEND_MESSAGES | PERM_ATTACH_FILES,
      spectators: undefined,
    }),
    currentId: config.partyChannelId ?? null,
    idColumn: { model: "gameConfig", id: 1, field: "partyChannelId" },
  });

  // --- Room threads -----------------------------------------------------
  //
  // The hash is composed exactly the way syncRoomThread composes it — body plus
  // the JSON of its component rows. Compose it any other way and every run
  // decides the starter has moved and reposts it, forever.
  const roomsByLocationId = new Map();
  for (const room of rooms) {
    const list = roomsByLocationId.get(room.locationId);
    if (list) list.push(room);
    else roomsByLocationId.set(room.locationId, [room]);
  }
  for (const room of rooms) {
    const location = locationById.get(room.locationId);
    const body = buildRoomBody(room, room.live ? liveStates.get(room.live) ?? null : null);
    const components = componentsByRoomId.get(room.id) ?? [];
    targets.push({
      targetType: "thread",
      kind: "room-thread",
      key: `thread:room:${room.id}`,
      subject: { type: "room", id: room.id },
      room,
      location: location ?? null,
      liveState: room.live ? liveStates.get(room.live) ?? null : null,
      label: `${location?.name ?? "?"} / ${room.name}`,
      name: room.name.slice(0, 100),
      parentKey: location ? `channel:location:${location.id}` : null,
      parentId: location?.discordChannelId ?? null,
      order: ORDER.ROOM_THREAD,
      bodyHash: hashBody(body + JSON.stringify(components)),
      currentHash: room.postHash ?? null,
      hasStarter: Boolean(room.starterMessageId),
      currentId: room.discordThreadId ?? null,
      idColumn: { model: "room", id: room.id, field: "discordThreadId" },
    });
  }

  // --- Location anchors -------------------------------------------------
  //
  // `roomsByLocationId` here is EVERY room row for the location — quest rooms
  // included, since they carry no `questId: null` filter the way the YAML
  // pruning pass does. That is deliberate: the old destructive zones sync only
  // ever saw rooms that came from the YAML (a quest room has no slug there,
  // so it never enters that pass's room list), but `refreshLocationAnchor`
  // (syncZones/sync.js) reads every row for the location with no such filter,
  // and it is that pass — not the full sync — that a quest's gate flip and
  // this mirror both need to agree with, so a quest room's public thread shows
  // up on the anchor exactly when refreshLocationAnchor would show it.
  for (const location of locations) {
    const roomList = (roomsByLocationId.get(location.id) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const body = buildAnchorBody(location, roomList);
    const components = locationAnchorRows(location);
    targets.push({
      targetType: "anchor",
      kind: "location-anchor",
      key: `anchor:location:${location.id}`,
      subject: { type: "location", id: location.id },
      location,
      rooms: roomList,
      label: location.name,
      parentKey: `channel:location:${location.id}`,
      parentId: location.discordChannelId ?? null,
      order: ORDER.ANCHOR,
      bodyHash: hashBody(`${body} ${JSON.stringify(components)}`),
      currentHash: location.anchorHash ?? null,
      currentId: location.anchorMessageId ?? null,
    });
  }

  for (const target of targets) {
    if (target.targetType === "channel") target.managedIds = managedIds;
  }

  return targets;
}

module.exports = { buildDesired, ORDER, gmRoleIdFor, LEVEL_CHANNEL_STRIDE };
