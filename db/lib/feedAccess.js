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
  DEADCHAT_PLACE_KEY,
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

// Equipped Scrying Eye + ROBES ON + not mirrored to Discord. Not mirrored,
// because Discord's channel permissions can't show rooms the eye opens;
// robes because a stolen eye is worth nothing outside the cult's dress.
// (docs/systemdocs/THANATI.md §4.)
async function hasScryingEye(prisma, characterId) {
  const row = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      discordMirrored: true,
      tags: {
        where: { equipped: true, quantity: { gt: 0 }, tag: { slug: { in: [SCRYING_EYE_SLUG, ...ROBE_SLUGS] } } },
        select: { tag: { select: { slug: true } } },
      },
    },
  });
  if (!row || row.discordMirrored) return false;
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
function place({
  placeKey,
  kind,
  name,
  description = "",
  roomKind = null,
  canSpeak,
  hasBoard = false,
  vantage = false,
  zoneId = null,
  zoneName = null,
}) {
  return {
    placeKey,
    kind,
    name,
    description: description ?? "",
    roomKind,
    canSpeak,
    // Which category this place sits in, so the web column can group by zone
    // the way Discord groups by category (web/app/(app)/chat/PlacesColumn.js).
    // Null means it belongs to no zone at all and is drawn above the groups:
    // the radio nets here, and the DM/Faction pseudo-places Chat.js adds.
    zoneId,
    zoneName,
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

// DEADCHAT (db/lib/deadchat.js): the room the dead talk in. It belongs to no zone, so it draws
// above the zone dividers with the nets — and it goes FIRST in a ghost's column, because it is the
// only place in that whole list they can actually answer.
//
// This is the one exception to "a watcher speaks nowhere". A ghost reads the world and cannot touch
// it; among themselves they can talk. A GM gets the same row read-only.
function deadchatPlace({ canSpeak }) {
  return place({
    placeKey: DEADCHAT_PLACE_KEY,
    kind: "dead",
    name: "Deadchat",
    description: "The dead talk among themselves. Nobody living can hear this.",
    canSpeak,
  });
}

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
// role to decide either — the ghost seat has no role left to read.
async function placesFor(prisma, character, { gm = false, ghost = false, discordUserId = null } = {}) {
  if (gm) return gmPlacesFor(prisma, discordUserId, { ghost });
  if (ghost) return ghostPlacesFor(prisma, discordUserId);
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
      where: { locationId: location.id, retiredAt: null },
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

  // Every place below is in the one zone this character stands in, so the
  // stamp is computed once and spread onto each of them.
  const zoneStamp = { zoneId: location.zone?.id ?? null, zoneName: location.zone?.name ?? null };

  const list = [
    place({
      placeKey: placeKeyForLocation(location.id),
      kind: "loc",
      name: location.name,
      description: location.description,
      canSpeak: LOCATION_CAN_SPEAK,
      ...zoneStamp,
    }),
    ...ordered.map((room) =>
      place({
        placeKey: placeKeyForRoom(room.id),
        kind: "room",
        name: room.name,
        description: room.description,
        roomKind: room.kind,
        canSpeak: reachableIds.has(room.id),
        ...zoneStamp,
      }),
    ),
    ...conversations.map((conversation) =>
      place({
        placeKey: placeKeyForConversation(conversation.id),
        kind: "conv",
        name: conversation.name,
        canSpeak: true,
        ...zoneStamp,
      }),
    ),
    ...overheard.map((conversation) =>
      place({
        placeKey: placeKeyForConversation(conversation.id),
        kind: "conv",
        name: conversation.name,
        canSpeak: false,
        ...zoneStamp,
      }),
    ),
  ];

  // THE FOG OF WAR (db/lib/vantages.js): the streets walked out of earlier
  // this turn, still watched, all of them read-only. After Here/Rooms so the
  // place you actually stand in is never buried under the places you don't.
  list.push(
    ...(await vantagePlacesFor(prisma, { id: character.id, zoneId: zoneStamp.zoneId }, keys, location.id, zoneStamp)),
  );

  if (location.zone) {
    list.push(
      place({
        placeKey: placeKeyForZone(location.zone.id),
        kind: "zone",
        name: location.zone.name,
        description: location.zone.description ?? "",
        canSpeak: true,
        ...zoneStamp,
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
async function vantagePlacesFor(prisma, character, keys, hereLocationId, zoneStamp) {
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
        where: { locationId, retiredAt: null },
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

    // A vantage is always in the zone stood in — vantagesFor is scoped by
    // zoneId — so it carries the caller's stamp and groups under that zone.
    out.push(
      place({
        placeKey: placeKeyForLocation(row.id),
        kind: "loc",
        name: row.name,
        description: row.description,
        canSpeak: false,
        vantage: true,
        ...zoneStamp,
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
          ...zoneStamp,
        }),
      ),
      ...conversations.map((conversation) =>
        place({
          placeKey: placeKeyForConversation(conversation.id),
          kind: "conv",
          name: `${row.name} · ${conversation.name}`,
          canSpeak: false,
          vantage: true,
          ...zoneStamp,
        }),
      ),
    );
  }
  return out;
}

// A GM reads every place in their chosen zones (db/lib/gmZoneView.js — no
// rows means every zone) and speaks in none: a GM who wants to say something
// in a scene says it as a GM, on Discord or through the desk.
async function gmPlacesFor(prisma, discordUserId, { ghost = false } = {}) {
  // Folds a seat down onto the zones it owns, so "Underground" arrives as
  // Underground + Caves + Depths with the cave Locations (db/lib/gmZoneView.js).
  const visible = await visibleZoneIds(prisma, discordUserId);
  const places = await watchedPlacesFor(prisma, {
    zoneIds: visible ? [...visible] : null,
    privateRooms: true,
    conversations: true,
    channellessSummaries: true,
    nets: SPECIAL_CHANNELS,
  });
  // Read-only, like everything else a GM watches. A GM with something to say to the dead says it as
  // a GM — through /dm or the desk — rather than as one of them.
  //
  // LAST, where a ghost gets it first. The left column draws it in the same fixed section either way
  // (PlacesColumn.js), so order only decides `places[0]` — the place Chat opens on. A ghost opens on
  // the one place they can answer; a GM opens on their zones, which is what they came for.
  //
  // Unless the GM is dead themselves: then Deadchat is their seat as much as anybody's, and they
  // speak there as their last character, the way the say route already resolves a ghost.
  return [...places, deadchatPlace({ canSpeak: ghost })];
}

// The ghost seat, on the web — and since the Ghost role went, the ONLY place it exists. A dead
// player reads every zone's summary, its Locations and their public Rooms, and the nets that
// declare `ghostsMaySee`. They speak in exactly one place: Deadchat, which goes first.
//
// WHO IS A GHOST is db/lib/ghost.js — a body, and no living character. Not db/lib/curse.js, which
// answers a different question (the re-roll penalty) with a different rule. The two used to be one
// predicate, so burying a body — which is meant to LIFT a penalty — also shut this seat.
//
// PRIVATE ROOMS AND CONVERSATIONS STAY OUT, and that is no longer a leftover from mirroring
// Discord. Putting a ghost in a private thread posts a visible system message AND adds them to its
// member list: either one announces the death to everybody in the room. The only way around it is
// granting MANAGE_THREADS, which is worse. The limit outlives the role that used to explain it.
//
// A cave level's summary is left out on the older ground: the level has no #summary channel
// (CAVING.md §1), so a zone place for it would be a surface nothing else in the game shows.
async function ghostPlacesFor(prisma, discordUserId) {
  const places = await watchedPlacesFor(prisma, {
    zoneIds: null,
    privateRooms: false,
    conversations: false,
    channellessSummaries: false,
    nets: SPECIAL_CHANNELS.filter((entry) => entry.ghostsMaySee),
  });
  return [deadchatPlace({ canSpeak: true }), ...places];
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
    retiredAt: null,
    ...(zoneIds ? { id: { in: zoneIds } } : {}),
  };

  // Zone.sortOrder is the authoring order from docs/zones.yaml, so the web
  // column reads Town, Fortress, … rather than alphabetically. It is scoped
  // WITHIN a group, though — Caves is 1 and so is Town — so the seat zone
  // (parentZoneId ?? id) has to sort first or the two cave levels interleave
  // with the surface zones. Seat first, own order second, gives Town,
  // Fortress, Forest, Black Hills, Marshes, Caves, Depths: the order the
  // Discord categories sit in, which is the point of grouping at all.
  const zones = await prisma.zone.findMany({
    where: zoneWhere,
    orderBy: [{ seatZone: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      discordSummaryChannelId: true,
      locations: {
        where: { retiredAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          attributes: true, // for hasNoticeboard below — a JSON blob, not a join
          rooms: {
            where: { retiredAt: null, ...(privateRooms ? {} : { kind: "PUBLIC" }) },
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
    const zoneStamp = { zoneId: zone.id, zoneName: zone.name };
    if (channellessSummaries || zone.discordSummaryChannelId) {
      list.push(
        place({
          placeKey: placeKeyForZone(zone.id),
          kind: "zone",
          name: zone.name,
          description: zone.description ?? "",
          canSpeak: false,
          ...zoneStamp,
        }),
      );
    }
    for (const location of zone.locations) {
      list.push(
        place({
          // No zone prefix: the column draws these under a zone divider that
          // already says it, and 15rem is not wide enough to say it twice.
          // Rooms and conversations keep theirs — a zone holds many Locations.
          placeKey: placeKeyForLocation(location.id),
          kind: "loc",
          name: location.name,
          description: location.description,
          canSpeak: false,
          hasBoard: hasNoticeboard(location),
          ...zoneStamp,
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
            ...zoneStamp,
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
            ...zoneStamp,
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
// everybody, and every place is read-only for a GM.
//
// A ghost has ONE exception, and only one: Deadchat. Everything else they watch is still canSpeak
// false, so this stays DERIVED from the list rather than growing a seat-shaped branch — the
// exception lives in ghostPlacesFor, where the row is built, and nothing here knows about it.
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
