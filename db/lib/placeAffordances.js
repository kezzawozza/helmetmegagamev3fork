// The place-bound affordances, declared once for both faces. A Location
// channel's pinned anchor and a Room thread's starter post carry buttons;
// Chat's place panel carries the same list. The catalog below is the shared
// half — id, label, Discord custom-id prefix; `affordancesFor` is the
// per-character half (which rooms/gates this character can reach).
// db/lib/locationAnchorRow.js and db/lib/roomStarterRow.js build their
// buttons off the catalog, so a new affordance is one entry here plus its
// dialog. The two halves can't be one function: an anchor is ONE message for
// everybody in the street, so it carries only what's true of the place —
// anything true of a person is a dialog on the web, a refusal on Discord.

const { hasNoticeboard } = require("./noticeboard");
const { QUEST_INTERACT_PREFIX } = require("./questText");
const { INTERCOM_ROOM_SLUG } = require("./intercom");
const { BELL_ROOM_SLUG } = require("./bell");
const { XOM_SHRINE_ROOM_SLUG } = require("./xom");
const { linksFor, gateOperable, endpoints, isHeldOpen } = require("./locationGraph");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");

// The one room with a big red button on the wall (docs/zones.yaml). Named
// here rather than imported from gatehouseTurret.js, which pulls in the whole turret engine.
const CENSOR_OFFICE_ROOM_SLUG = "garrison-censors-office";

// The four rooms that work a gate. Every modular edge in docs/zones.yaml has
// exactly one of these; Open/Close renders on that room's starter post and
// NOWHERE ELSE — the winch is in the tower, not on the open road.
const WATCHTOWER_ROOM_SLUGS = new Set([
  "gatehouse-watchtower", //  fortress/gatehouse <-> fortress/road
  "customs-watchtower", //    caves/customs      <-> caves/caves-approach
  "north-gate-watchtower", // town/north-gate    <-> forest/forest-northern-road
  "south-gate-watchtower", // town/south-gate    <-> forest/forest-south
]);

// Not a prefix but one fixed id: travel needs no location context, since the handler reads the mover's own locationId.
const TRAVEL_CUSTOM_ID = "loc:open";
const WHOS_HERE_PREFIX = "loc:who:";
const NOTICEBOARD_PREFIX = "loc:notice:";
const SECRET_ROOMS_PREFIX = "loc:secret:";
const EXAMINE_PREFIX = "loc:examine:";
const CONVERSE_PREFIX = "loc:converse:";
const GATE_PREFIX = "loc:gate:";
const KEYED_PREFIX = "loc:keyed:";
const ROOM_STORAGE_PREFIX = "room:storage:";
const ROOM_INTERCOM_PREFIX = "room:intercom:";
const ROOM_TURRET_PREFIX = "room:turret:";
const ROOM_BELL_PREFIX = "room:bell:";
const ROOM_PRAY_PREFIX = "room:pray:";

// `tone` is what the affordance MEANS, never a colour — each face maps it to its own look.
const GO = "go";
const PLAIN = "plain";
const DANGER = "danger";

// Everything on a Location's anchor, in the order it draws. Travel is first — the others answer where you already are, this is how you leave.
const LOCATION_AFFORDANCES = [
  { id: "travel", label: "Travel", tone: GO, customId: () => TRAVEL_CUSTOM_ID },
  { id: "whosHere", label: "Who's here?", tone: PLAIN, prefix: WHOS_HERE_PREFIX },
  { id: "secretRooms", label: "Secret rooms?", tone: PLAIN, prefix: SECRET_ROOMS_PREFIX },
  { id: "examine", label: "Examine", tone: PLAIN, prefix: EXAMINE_PREFIX },
  { id: "converse", label: "Converse", tone: PLAIN, prefix: CONVERSE_PREFIX },
  // Only where docs/zones.yaml declared one (db/lib/noticeboard.js).
  { id: "noticeboard", label: "Noticeboard", tone: PLAIN, prefix: NOTICEBOARD_PREFIX, when: hasNoticeboard },
];

// Everything on a Room's starter post. Storage is on every one of them;
// Intercom is on exactly one (the Council Room), Toggle Turret on exactly one
// other (the Censor's Office), Sound Bell on the Cathedral's Bell Tower.
const ROOM_AFFORDANCES = [
  // A Quest's one button, and the only affordance that isn't a standing fact
  // about a place — a GM staged it (QUESTS.md). Quest id rides in the
  // custom_id, not the room id, since the quest outlives its room.
  {
    id: "questInteract",
    label: "Interact",
    tone: GO,
    when: (room) => Boolean(room?.questId),
    customId: (_id, room) => `${QUEST_INTERACT_PREFIX}${room?.questId ?? ""}`,
  },
  { id: "storage", label: "Storage", tone: PLAIN, prefix: ROOM_STORAGE_PREFIX },
  {
    id: "intercom",
    label: "Intercom",
    tone: PLAIN,
    prefix: ROOM_INTERCOM_PREFIX,
    when: (room) => room?.slug === INTERCOM_ROOM_SLUG,
  },
  // The only red button in the game: arms a gun that doesn't check who anyone is.
  {
    id: "turret",
    label: "Toggle Turret",
    tone: DANGER,
    prefix: ROOM_TURRET_PREFIX,
    when: (room) => room?.slug === CENSOR_OFFICE_ROOM_SLUG,
  },
  {
    id: "bell",
    label: "Sound Bell",
    tone: PLAIN,
    prefix: ROOM_BELL_PREFIX,
    when: (room) => room?.slug === BELL_ROOM_SLUG,
  },
  // The Shrine of an Old Man: the only button that hands you a permanent tag that can kill you, with no way back off it.
  {
    id: "pray",
    label: "Pray",
    tone: DANGER,
    prefix: ROOM_PRAY_PREFIX,
    when: (room) => room?.slug === XOM_SHRINE_ROOM_SLUG,
  },
];

// `subject` is the whole row the affordance resolved against, for the one def needing a field off it rather than its id.
function customIdFor(def, id, subject = null) {
  return def.customId ? def.customId(id, subject) : `${def.prefix}${id}`;
}

// Location affordances for this place. `location` may be a bare id, dropping
// conditional ones — nothing can be decided about a place that's only a string.
function locationAffordances(location) {
  const id = typeof location === "string" ? location : location?.id;
  const known = typeof location === "string" ? null : location;
  return LOCATION_AFFORDANCES.filter((def) => !def.when || (known ? def.when(known) : false)).map((def) => ({
    id: def.id,
    label: def.label,
    tone: def.tone,
    customId: customIdFor(def, id),
  }));
}

// `room` needs { id, slug, questId }.
function roomAffordances(room) {
  return ROOM_AFFORDANCES.filter((def) => !def.when || def.when(room)).map((def) => ({
    id: def.id,
    label: def.label,
    tone: def.tone,
    roomId: room.id,
    customId: customIdFor(def, room.id, room),
  }));
}

// The label a gate button wears. Far side named because a location can hold
// two gates and "Close" alone would be a coin flip.
function gateLabel({ isOpen, farName }) {
  return `${isOpen ? "Close" : "Open"} the way to ${farName}`;
}

// EVERYTHING this character can do where they are standing, one ordered
// list; Chat's place panel is a render of this and nothing else. Each entry
// is { id, label, tone, kind, roomId?, linkId?, roomName? } — `kind` is
// "place"/"room"/"gate"/"keyed". `character` needs { id, locationId, role:
// { slug }, tags: [{ tag: { slug } }] }.
async function affordancesFor(prisma, character) {
  if (!character?.locationId) return [];

  const [location, rooms, keys, links] = await Promise.all([
    prisma.location.findUnique({
      where: { id: character.locationId },
      select: { id: true, name: true, attributes: true },
    }),
    prisma.room.findMany({
      where: { locationId: character.locationId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true, kind: true, accessTagSlugs: true, questId: true },
    }),
    roomAccessKeys(prisma, character.id),
    linksFor(prisma, character.locationId),
  ]);
  if (!location) return [];

  const out = locationAffordances(location).map((entry) => ({ ...entry, kind: "place" }));

  // A room's buttons, for every room this character can actually get into — a locked door offers nothing.
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  for (const room of open) {
    for (const entry of roomAffordances(room)) {
      out.push({ ...entry, kind: "room", roomName: room.name });
    }
  }

  // Reaching the watchtower IS the permission — anyone the tower's `access:` list lets in may work the gate.
  const towerHere = open.some((room) => WATCHTOWER_ROOM_SLUGS.has(room.slug));
  const tagSlugs = (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean);
  for (const link of links ?? []) {
    if (!gateOperable(link)) continue;
    if (!towerHere) continue;
    const farName = endpoints(link, character.locationId).far.name;
    out.push({
      id: "gate",
      kind: "gate",
      linkId: link.id,
      label: gateLabel({ isOpen: link.isOpen, farName }),
      tone: link.isOpen ? DANGER : GO,
      isOpen: link.isOpen,
      farName,
    });
  }

  // A keyed door is not a gate: no winch, no anchor button. Only the key
  // holder gets it, and already-held ways are listed rather than offering a click that refuses.
  for (const link of links ?? []) {
    if (!link.keyed) continue;
    if (!tagSlugs.includes(link.requiredTagSlug)) continue;
    const farName = endpoints(link, character.locationId).far.name;
    out.push({
      id: "keyed",
      kind: "keyed",
      linkId: link.id,
      label: `Hold the way to ${farName} open`,
      tone: PLAIN,
      held: isHeldOpen(link),
      farName,
    });
  }

  return out;
}

module.exports = {
  GO,
  DANGER,
  TRAVEL_CUSTOM_ID,
  WHOS_HERE_PREFIX,
  NOTICEBOARD_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  ROOM_BELL_PREFIX,
  ROOM_PRAY_PREFIX,
  QUEST_INTERACT_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
  WATCHTOWER_ROOM_SLUGS,
  ROOM_AFFORDANCES,
  locationAffordances,
  roomAffordances,
  gateLabel,
  affordancesFor,
};
