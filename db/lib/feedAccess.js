// Which places a character may read and write, for both faces.
//
// This is the ONE answer. The SSE route asks it to decide what a stream
// subscribes to, the say route asks it to decide whether a message is allowed,
// db/lib/say.js asks it inside prepareSpeech, and the page asks it to draw the
// left column. Re-implementing any of that in a route is how a private Room
// ends up readable by somebody standing outside it.
//
// placesFor() is the primitive and mayReadPlace/mayWritePlace derive from it,
// rather than the other way round: a rule that only exists in the list can
// never disagree with the rule that guards a send.
//
// Takes `prisma` where it needs it, same reason as archive.js and placeKey.js:
// db/index.js imports this, so requiring it back would resolve to a partial
// exports object.

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

// Equipped Scrying Eye, ROBES ON, AND the web-only switch on. The web-only
// half is technical: Discord's channel permissions could never show a
// character the rooms the eye opens, so it works only for someone who has left
// Discord. The robes are Bascinet's rule — "holding it in your hand while
// wearing your robes lets you see through walls" — which also means a
// stolen eye is worth nothing to a thief who is not in the cult's dress.
// (docs/systemdocs/THANATI.md §4.)
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

// How long a character waits between two sends in one place, in ms. The zone
// summary is a slower surface on purpose: it is a whole zone reading.
// Rooms and Conversations have no slowmode (Bascinet, 2026-09-06); only the
// zone summary does, matching its Discord channel.
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
    // Only a Location ever carries one, and only the GM list fills it in: a
    // player's board reaches them through affordancesFor, off the Location
    // they are standing in. A GM is standing nowhere and picks the place off
    // the left column, so the column has to say which places have a board.
    hasBoard,
    slowmodeSeconds: Math.round(slowmodeMsFor(placeKey) / 1000),
  };
}

// A Location channel is SCENERY now, not speech (the plan's decision 5, and
// CHANNELS.md §2). Arrivals, smells, the turret and the noticeboard land
// there; talking happens in a Room thread, a Conversation or the zone
// summary. Discord enforces the same thing by dropping Send from
// LOCATION_MEMBER_ALLOW, so a player meets one rule on both faces.
const LOCATION_CAN_SPEAK = false;

// The radio nets this character is on. A net belongs to no Location and no
// zone — it travels with whoever is carrying the radio — so it is built from
// the character alone, and the rule is the SAME one that writes the Discord
// overwrites (db/lib/specialChannels.js). One rule, two faces: a bracelet
// that only receives is canSpeak false here for the same reason it holds no
// Send bit there.
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
  // A radio works wherever you are, including nowhere: a character with no
  // Location still hears their nets rather than getting an empty column.
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

  // The same accessibleRooms() every other door in the game reads, guests
  // included — a guest who is shown the thread on Discord and refused the
  // feed on the web would be two answers to one question.
  const reachable = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  // THE SCRYING EYE (docs/systemdocs/THANATI.md §4): equipped, and only with
  // the web-only switch on, every room and every conversation at this Location
  // is readable. What the eye adds arrives with canSpeak false, so
  // mayWritePlace still refuses it; what the character could already enter
  // keeps its voice.
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
  // Public first, then the private ones a key or a guest row opens: the
  // column draws them as two sections and the order is what separates them.
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

// A GM reads every place inside the zones they have chosen to see
// (db/lib/gmZoneView.js — no rows means every zone) and speaks in none of
// them. Watching is not standing there: a GM who wants to say something in a
// scene says it as a GM, on Discord or through the desk.
async function gmPlacesFor(prisma, discordUserId) {
  // visibleZoneIds already folds a seat down onto the zones it owns, so
  // "Underground" arrives here as Underground + Caves + Depths and the cave
  // Locations come with it (db/lib/gmZoneView.js).
  const visible = await visibleZoneIds(prisma, discordUserId);
  // A CAVE_GROUP is a Discord category and a GM seat, never a place: it holds
  // no Locations and the sync gives it no #summary channel, so listing it
  // would draw a row that opens nothing. Its two levels carry the places.
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
          // For hasNoticeboard below — the one Location attribute the GM's
          // column needs, and it is a JSON blob rather than a join.
          attributes: true,
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

  // The radio nets, flat and last. They belong to no zone, so GmZoneView has
  // nothing to say about them and there is nowhere to nest them — but a GM
  // holds both channels on Discord, so withholding them here would only make
  // the desk the one place a GM cannot read a frequency.
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

// Both of these DERIVE from the list. That is the point: there is no second
// copy of the rule to fall out of step with the column a player is looking at.
async function findPlace(prisma, character, placeKey, options) {
  if (!placeKey) return null;
  const list = await placesFor(prisma, character, options);
  return list.find((entry) => entry.placeKey === placeKey) ?? null;
}

async function mayReadPlace(prisma, character, placeKey, options) {
  return Boolean(await findPlace(prisma, character, placeKey, options));
}

// Reading and writing parted company in phase 2: a Location is read-only for
// everybody, and every place is read-only for a GM.
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
