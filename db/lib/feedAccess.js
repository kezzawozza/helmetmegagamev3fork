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
const { vantagesFor } = require("./vantages");

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
function place({ placeKey, kind, name, description = "", roomKind = null, canSpeak, hasBoard = false, vantage = false }) {
  return {
    placeKey,
    kind,
    name,
    description: description ?? "",
    roomKind,
    canSpeak,
    // A place you walked out of and are still watching (db/lib/vantages.js).
    // Read-only by construction — every vantage place is built with canSpeak
    // false — and drawn under its own heading in the left column. The mirror
    // of holding LOCATION_VANTAGE_ALLOW on the Discord channel: the view, and
    // no send bit.
    vantage,
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
//
// `gm` and `ghost` are the two ways of reading with no living character at
// all: a GM over the zones they watch, a dead player over every zone. Both
// come from web/lib/feedAccess.js#loadFeedViewer and nothing here reads a
// role to decide either.
async function placesFor(prisma, character, { gm = false, ghost = false, discordUserId = null } = {}) {
  if (gm) return gmPlacesFor(prisma, discordUserId);
  if (ghost) return ghostPlacesFor(prisma);
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

  // THE FOG OF WAR (db/lib/vantages.js): the streets walked out of earlier
  // this turn, still watched, all of them read-only. After Here/Rooms so the
  // place you actually stand in is never buried under the places you don't.
  list.push(...(await vantagePlacesFor(prisma, { id: character.id, zoneId: location.zone?.id ?? null }, keys, location.id)));

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

// The lit-but-left half of the column. One section per Location this character
// walked out of this turn and is still in the zone of: the street, the rooms a
// door opens for them, and the conversations they are in there.
//
// EVERYTHING here is canSpeak false, with no exception and no per-place rule to
// get wrong. That is the exact mirror of holding LOCATION_VANTAGE_ALLOW on the
// Discord channel — the view bit and nothing else — so the two faces cannot
// answer differently about a street you are not standing in.
//
// `character` is narrowed to { id, zoneId } by the caller rather than trusted
// off the session row: the zone is read from the Location they are standing in
// this instant, so a row lit in a zone they have since left is dark here even
// if the wipe that should have removed it never ran.
//
// `keys` is the caller's roomAccessKeys, computed once for the whole list. A
// guest row is spent by walking out (db/lib/roomAccess.js), so a room somebody
// was let into does NOT follow them into the fog — only a key or a quest does.
// No Scrying Eye here either: the eye is for the room you are standing in.
async function vantagePlacesFor(prisma, character, keys, hereLocationId) {
  const vantages = await vantagesFor(prisma, character).catch((err) => {
    console.error(`Vantage places failed for ${character?.id}:`, err.message ?? err);
    return [];
  });
  if (vantages.length === 0) return [];

  const out = [];
  for (const vantage of vantages) {
    const locationId = vantage.locationId;
    // Standing beats watching. A row for where they stand should never exist
    // — every arrival clears one — but drawing the street twice, once as Here
    // and once as Elsewhere, is a bad way to find out it does.
    if (locationId === hereLocationId) continue;
    const [row, rooms, conversations] = await Promise.all([
      prisma.location.findUnique({
        where: { id: locationId },
        select: { id: true, name: true, description: true },
      }),
      prisma.room.findMany({
        where: { locationId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, description: true, kind: true, accessTagSlugs: true },
      }),
      conversationsFor(prisma, character.id, { locationId }),
    ]);
    if (!row) continue;

    const reachable = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
    const ordered = [
      ...reachable.filter((room) => room.kind !== "PRIVATE"),
      ...reachable.filter((room) => room.kind === "PRIVATE"),
    ];

    out.push(
      place({
        placeKey: placeKeyForLocation(row.id),
        kind: "loc",
        name: row.name,
        description: row.description,
        canSpeak: false,
        vantage: true,
      }),
      ...ordered.map((room) =>
        place({
          placeKey: placeKeyForRoom(room.id),
          kind: "room",
          name: `${row.name} · ${room.name}`,
          description: room.description,
          roomKind: room.kind,
          canSpeak: false,
          vantage: true,
        }),
      ),
      ...conversations.map((conversation) =>
        place({
          placeKey: placeKeyForConversation(conversation.id),
          kind: "conv",
          name: `${row.name} · ${conversation.name}`,
          canSpeak: false,
          vantage: true,
        }),
      ),
    );
  }
  return out;
}

// A GM reads every place in their chosen zones (db/lib/gmZoneView.js — no
// rows means every zone) and speaks in none: a GM who wants to say something
// in a scene says it as a GM, on Discord or through the desk.
async function gmPlacesFor(prisma, discordUserId) {
  // Folds a seat down onto the zones it owns, so "Underground" arrives as
  // Underground + Caves + Depths with the cave Locations (db/lib/gmZoneView.js).
  const visible = await visibleZoneIds(prisma, discordUserId);
  return watchedPlacesFor(prisma, {
    zoneIds: visible ? [...visible] : null,
    privateRooms: true,
    conversations: true,
    channellessSummaries: true,
    nets: SPECIAL_CHANNELS,
  });
}

// The ghost seat, on the web. A dead player reads every zone's summary, its
// Locations and their public Rooms, and the nets that declare `ghostsMaySee`
// — exactly what the Ghost role's overwrite lets them see on Discord
// (CHANNELS.md §5, db/lib/ghostAccess.js), and nothing more: a private Room
// or a conversation is a private thread there, invisible to any non-member,
// so it stays out of the column here too. Speaking in none of it; a ghost
// has no voice (docs/documents.yaml, Respawning). Until this existed a dead
// player's Chat was the DM thread and an empty column, while the same person
// on Discord could read the whole map.
//
// A cave level's summary is left out for the same reason: the level has no
// #summary channel (CAVING.md §1), so its zone place here is a web-only
// surface the Discord seat never shows. A GM reads it because a GM reads
// everything; a ghost reads what the role reads.
async function ghostPlacesFor(prisma) {
  return watchedPlacesFor(prisma, {
    zoneIds: null,
    privateRooms: false,
    conversations: false,
    channellessSummaries: false,
    nets: SPECIAL_CHANNELS.filter((entry) => entry.ghostsMaySee),
  });
}

// The read-only list both watchers above draw from: every place inside
// `zoneIds` (null means every zone), flat, zone by zone. `privateRooms`,
// `conversations` and `channellessSummaries` are what separates the GM's
// seat from the ghost's.
async function watchedPlacesFor(prisma, { zoneIds, privateRooms, conversations, channellessSummaries, nets }) {
  // A CAVE_GROUP is a Discord category and a GM seat, never a place: it holds
  // no Locations and the sync gives it no #summary channel, so listing it
  // would draw a row that opens nothing. Its two levels carry the places.
  const zoneWhere = {
    kind: { not: "CAVE_GROUP" },
    ...(zoneIds ? { id: { in: zoneIds } } : {}),
  };

  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      discordSummaryChannelId: true,
      locations: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          attributes: true, // for hasNoticeboard below — a JSON blob, not a join
          rooms: {
            ...(privateRooms ? {} : { where: { kind: "PUBLIC" } }),
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: { id: true, name: true, description: true, kind: true },
          },
          playerThreads: conversations
            ? { orderBy: { createdAt: "asc" }, select: { id: true, name: true } }
            : false,
        },
      },
    },
  });

  const list = [];
  for (const zone of zones) {
    if (channellessSummaries || zone.discordSummaryChannelId) {
      list.push(
        place({
          placeKey: placeKeyForZone(zone.id),
          kind: "zone",
          name: zone.name,
          description: zone.description ?? "",
          canSpeak: false,
        }),
      );
    }
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
      for (const conversation of location.playerThreads ?? []) {
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
  for (const entry of nets) {
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

// Reading and writing parted company in phase 2: a Location is read-only for
// everybody, and every place is read-only for a GM and for a ghost.
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
