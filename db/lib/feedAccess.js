// The ONE answer for which places a character may read/write, on both faces
// (SSE stream, say route, db/lib/say.js, the page's left column). Re-implementing
// this in a route risks a private Room readable from outside it. mayReadPlace/
// mayWritePlace derive from placesFor() so they can never disagree with it.
// Takes `prisma` as a param: db/index.js imports this, so requiring it back
// would resolve to a partial exports object (same as archive.js, placeKey.js).

const {
  placeKeyForLocation,
  placeKeyForRoom,
  placeKeyForConversation,
  placeKeyForZone,
  placeKeyForNet,
  parsePlaceKey,
} = require("./placeKey");
const {
  SPECIAL_CHANNELS,
  buildNarrowcastContext,
  computeNarrowcastAccess,
} = require("./specialChannels");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
const { hasNoticeboard } = require("./noticeboard");
const { conversationsFor } = require("./conversations");
const { visibleZoneIds } = require("./gmZoneView");
const { SCRYING_EYE_SLUG, ROBE_SLUGS } = require("./thanati");

// Equipped Scrying Eye + ROBES ON + web-only switch. Web-only because Discord's
// channel permissions can't show rooms the eye opens; robes because a stolen
// eye is worth nothing outside the cult's dress. (docs/systemdocs/THANATI.md §4.)
async function hasScryingEye(prisma, characterId) {
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      webOnly: true,
      tags: {
        where: { equipped: true, quantity: { gt: 0 }, tag: { slug: { in: [SCRYING_EYE_SLUG, ...ROBE_SLUGS] } } },
        select: { tag: { select: { slug: true } } },
      },
    },
  });
  if (!row?.webOnly) return false;
  const slugs = new Set(row.tags.map((ct) => ct.tag.slug));
  return slugs.has(SCRYING_EYE_SLUG) && ROBE_SLUGS.some((slug) => slugs.has(slug));
}

// Wait between two sends in one place, in ms. Only the zone summary has
// slowmode (a whole zone reading it), matching its Discord channel.
const PLACE_SLOWMODE_MS = 0;
const ZONE_SLOWMODE_MS = 300_000;

function slowmodeMsFor(placeKey) {
  return parsePlaceKey(placeKey)?.kind === "zone" ? ZONE_SLOWMODE_MS : PLACE_SLOWMODE_MS;
}

// One line of a place list. `canSpeak` is the composer's gate and the send
// route's; `slowmodeSeconds` is what the composer tells a player they are
// waiting for. `roomKind` is null for anything that is not a Room.
function place({ placeKey, kind, name, description = "", roomKind = null, canSpeak, hasBoard = false }) {
  return {
    placeKey,
    kind,
    name,
    description: description ?? "",
    roomKind,
    canSpeak,
    // Only a Location carries one, only the GM list fills it: a player's board
    // comes through affordancesFor; a GM picks off the left column instead.
    hasBoard,
    slowmodeSeconds: Math.round(slowmodeMsFor(placeKey) / 1000),
  };
}

// A Location channel is SCENERY, not speech (CHANNELS.md §2); talking happens
// in a Room thread, a Conversation or the zone summary. Discord enforces the
// same thing by dropping Send from LOCATION_MEMBER_ALLOW — one rule, two faces.
const LOCATION_CAN_SPEAK = false;

// The radio nets this character is on. A net travels with the radio, not a
// Location or zone, and uses the SAME rule that writes the Discord overwrites
// (db/lib/specialChannels.js) — a receive-only bracelet is canSpeak false here
// for the same reason it holds no Send bit there.
async function netPlacesFor(prisma, characterId) {
  if (!characterId) return [];
  const access = computeNarrowcastAccess(await buildNarrowcastContext(prisma, characterId));
  const out = [];
  for (const entry of SPECIAL_CHANNELS) {
    const grant = access[entry.slug];
    if (!grant) continue;
    out.push(
      place({
        placeKey: placeKeyForNet(entry.slug),
        kind: "net",
        name: entry.slug,
        description: entry.topic ?? "",
        canSpeak: Boolean(grant.send),
      }),
    );
  }
  return out;
}

// The places one living character may read, in the order the left column
// draws them: where you are, the rooms off it, the conversations you are in,
// then the zone's summary — and the radio nets, which are nowhere.
async function placesFor(prisma, character, { gm = false, discordUserId = null } = {}) {
  if (gm) return gmPlacesFor(prisma, discordUserId);
  if (!character?.id) return [];
  // A radio works even with no Location, so the column isn't empty.
  const nets = await netPlacesFor(prisma, character.id);
  if (!character.locationId) return nets;

  const location = await prisma.location.findUnique({
    where: { id: character.locationId },
    select: {
      id: true,
      name: true,
      description: true,
      zone: { select: { id: true, name: true, description: true } },
    },
  });
  if (!location) return [];

  const [rooms, keys, conversations, scrying] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: location.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, kind: true, accessTagSlugs: true },
    }),
    roomAccessKeys(prisma, character.id),
    conversationsFor(prisma, character.id, { locationId: location.id }),
    hasScryingEye(prisma, character.id),
  ]);

  // The same accessibleRooms() every door in the game reads — a guest shown
  // the thread on Discord but refused the feed here would be two answers to
  // one question.
  const reachable = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  // THE SCRYING EYE (docs/systemdocs/THANATI.md §4): with it, every room/
  // conversation here is readable but canSpeak false; what was already
  // enterable keeps its voice.
  const reachableIds = new Set(reachable.map((room) => room.id));
  const seen = scrying ? rooms : reachable;
  const memberConversationIds = conversations.map((c) => c.id);
  const overheard = scrying
    ? await prisma.playerThread.findMany({
        where: { locationId: location.id, id: { notIn: memberConversationIds } },
        orderBy: { lastActivityAt: "desc" },
        select: { id: true, name: true },
      })
    : [];
  // Public first, then private ones a key/guest row opens — order is the
  // only thing separating the two sections the column draws.
  const ordered = [
    ...seen.filter((room) => room.kind !== "PRIVATE"),
    ...seen.filter((room) => room.kind === "PRIVATE"),
  ];

  const list = [
    place({
      placeKey: placeKeyForLocation(location.id),
      kind: "loc",
      name: location.name,
      description: location.description,
      canSpeak: LOCATION_CAN_SPEAK,
    }),
    ...ordered.map((room) =>
      place({
        placeKey: placeKeyForRoom(room.id),
        kind: "room",
        name: room.name,
        description: room.description,
        roomKind: room.kind,
        canSpeak: reachableIds.has(room.id),
      }),
    ),
    ...conversations.map((conversation) =>
      place({
        placeKey: placeKeyForConversation(conversation.id),
        kind: "conv",
        name: conversation.name,
        canSpeak: true,
      }),
    ),
    ...overheard.map((conversation) =>
      place({
        placeKey: placeKeyForConversation(conversation.id),
        kind: "conv",
        name: conversation.name,
        canSpeak: false,
      }),
    ),
  ];

  if (location.zone) {
    list.push(
      place({
        placeKey: placeKeyForZone(location.zone.id),
        kind: "zone",
        name: location.zone.name,
        description: location.zone.description ?? "",
        canSpeak: true,
      }),
    );
  }

  list.push(...nets);

  return list;
}

// A GM reads every place in their chosen zones (db/lib/gmZoneView.js — no
// rows means every zone) and speaks in none: a GM who wants to say something
// in a scene says it as a GM, on Discord or through the desk.
async function gmPlacesFor(prisma, discordUserId) {
  // Folds a seat down onto the zones it owns, so "Underground" arrives as
  // Underground + Caves + Depths with the cave Locations (db/lib/gmZoneView.js).
  const visible = await visibleZoneIds(prisma, discordUserId);
  // A CAVE_GROUP is a Discord category/GM seat, never a place — no Locations,
  // no #summary; its two levels carry the places instead.
  const zoneWhere = {
    kind: { not: "CAVE_GROUP" },
    ...(visible ? { id: { in: [...visible] } } : {}),
  };

  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      locations: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          attributes: true, // for hasNoticeboard below — a JSON blob, not a join
          rooms: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: { id: true, name: true, description: true, kind: true },
          },
          playerThreads: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
        },
      },
    },
  });

  const list = [];
  for (const zone of zones) {
    list.push(
      place({
        placeKey: placeKeyForZone(zone.id),
        kind: "zone",
        name: zone.name,
        description: zone.description ?? "",
        canSpeak: false,
      }),
    );
    for (const location of zone.locations) {
      list.push(
        place({
          placeKey: placeKeyForLocation(location.id),
          kind: "loc",
          name: `${zone.name} · ${location.name}`,
          description: location.description,
          canSpeak: false,
          hasBoard: hasNoticeboard(location),
        }),
      );
      for (const room of location.rooms) {
        list.push(
          place({
            placeKey: placeKeyForRoom(room.id),
            kind: "room",
            name: `${location.name} · ${room.name}`,
            description: room.description,
            roomKind: room.kind,
            canSpeak: false,
          }),
        );
      }
      for (const conversation of location.playerThreads) {
        list.push(
          place({
            placeKey: placeKeyForConversation(conversation.id),
            kind: "conv",
            name: `${location.name} · ${conversation.name}`,
            canSpeak: false,
          }),
        );
      }
    }
  }

  // Radio nets, flat and last: belong to no zone, but a GM holds both
  // channels on Discord so the desk shouldn't be the one place they can't read one.
  for (const entry of SPECIAL_CHANNELS) {
    list.push(
      place({
        placeKey: placeKeyForNet(entry.slug),
        kind: "net",
        name: entry.slug,
        description: entry.topic ?? "",
        canSpeak: false,
      }),
    );
  }

  return list;
}

// DERIVE from the list, so there's no second copy of the rule to fall out of
// step with the column a player is looking at.
async function findPlace(prisma, character, placeKey, options) {
  if (!placeKey) return null;
  const list = await placesFor(prisma, character, options);
  return list.find((entry) => entry.placeKey === placeKey) ?? null;
}

async function mayReadPlace(prisma, character, placeKey, options) {
  return Boolean(await findPlace(prisma, character, placeKey, options));
}

// A Location is read-only for everybody; every place is read-only for a GM.
async function mayWritePlace(prisma, character, placeKey, options) {
  const found = await findPlace(prisma, character, placeKey, options);
  return Boolean(found?.canSpeak);
}

module.exports = {
  placesFor,
  findPlace,
  mayReadPlace,
  mayWritePlace,
  slowmodeMsFor,
  PLACE_SLOWMODE_MS,
};
