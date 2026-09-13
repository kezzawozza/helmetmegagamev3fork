// The place-bound affordances, declared once for both faces.
//
// A Location channel's pinned anchor and a Room thread's starter post carry
// buttons; Chat's place panel carries the same list as web dialogs. Until
// phase 3 those were two hand-kept lists in two files, and adding a button to
// one was no reminder at all to add it to the other.
//
// The catalog below is the shared half — an id, the label a player reads, and
// the Discord custom-id prefix the bot routes on. `affordancesFor` is the
// per-character half, which needs prisma: which rooms this character can get
// into, which gates they are standing at, whether the way they came through
// is theirs to hold open. db/lib/locationAnchorRow.js and
// db/lib/roomStarterRow.js build their buttons off the catalog, so a new
// affordance is one entry here plus its dialog.
//
// The two halves cannot be one function: an anchor is ONE message for
// everybody standing in the street, so it can only carry what is true of the
// place. Anything true of a person — a key, a stash they may open — is a
// dialog on the web and a refusal on Discord.

const { hasNoticeboard } = require("./noticeboard");
const { QUEST_INTERACT_PREFIX } = require("./questText");
const { INTERCOM_ROOM_SLUG } = require("./intercom");
const { BELL_ROOM_SLUG } = require("./bell");
const { XOM_SHRINE_ROOM_SLUG } = require("./xom");
const { linksFor, gateOperable, endpoints, isHeldOpen } = require("./locationGraph");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");

// The one room with a big red button on the wall (docs/zones.yaml). Named
// here rather than imported from gatehouseTurret.js because that module pulls
// in the whole turret engine, and the sync loads this file to draw a row.
const CENSOR_OFFICE_ROOM_SLUG = "garrison-censors-office";

// The four rooms that work a gate. Every modular edge in docs/zones.yaml has
// exactly one of these at one of its ends, and the Open/Close button renders
// on that room's starter post and NOWHERE ELSE — not on either endpoint's
// Location anchor, which is where it used to live. A portcullis has a winch,
// and the winch is in the tower; you should not be able to drop one from the
// open road.
const WATCHTOWER_ROOM_SLUGS = new Set([
  "gatehouse-watchtower", //  fortress/gatehouse <-> fortress/road
  "customs-watchtower", //    caves/customs      <-> caves/caves-approach
  "north-gate-watchtower", // town/north-gate    <-> forest/forest-northern-road
  "south-gate-watchtower", // town/south-gate    <-> forest/forest-south
]);

// Not a prefix but one fixed id, shared with the #turns console and the
// /travel command: travel needs no location context, because the handler
// reads the mover's own locationId.
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

// `tone` is what the affordance MEANS, never a colour: Discord maps it to a
// button style and the web maps it to a .btn variant, so neither face reaches
// for a look the other cannot express.
const GO = "go";
const PLAIN = "plain";
const DANGER = "danger";

// Everything on a Location's anchor, in the order it draws. Travel is first
// and is the one people are here to press — the others answer a question
// about where you already are, and this one is how you leave.
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
  // A Quest's one button, and the only affordance in the game that is not a
  // standing fact about a place — a GM staged it, and closing the quest takes
  // it away again (docs/systemdocs/QUESTS.md). First in the row because it is
  // the thing anybody walking in here came to press.
  //
  // The QUEST id rides in the custom_id, not the room id, because the quest
  // outlives its room: closing one deletes the thread and keeps the record.
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
  // The only red button in the game. It arms a gun that does not check who
  // anyone is, so it should not look like the others.
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
  // The Shrine of an Old Man, at the bottom of the Chasm. Danger, and not
  // because it is loud: it is the only button in the game that hands you a
  // permanent tag which can kill you, and there is no way back off it.
  {
    id: "pray",
    label: "Pray",
    tone: DANGER,
    prefix: ROOM_PRAY_PREFIX,
    when: (room) => room?.slug === XOM_SHRINE_ROOM_SLUG,
  },
];

// `subject` is the whole row the affordance was resolved against, for the one
// def that needs a field off it rather than the id it is keyed by.
function customIdFor(def, id, subject = null) {
  return def.customId ? def.customId(id, subject) : `${def.prefix}${id}`;
}

// The Location affordances that apply to this place. `location` may be a bare
// id, in which case the conditional ones are dropped — nothing can be decided
// about a place that is only a string.
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

// The label a gate button wears. The far side is named because a location can
// hold two gates and "Close" alone would be a coin flip, and the verb is what
// the click DOES, not what the gate currently is.
function gateLabel({ isOpen, farName }) {
  return `${isOpen ? "Close" : "Open"} the way to ${farName}`;
}

// EVERYTHING this character can do where they are standing, as one ordered
// list. Chat's place panel is a render of this and nothing else.
//
// Each entry is { id, label, tone, kind, roomId?, linkId?, roomName? }.
// `kind` is the group it draws under: "place" for the Location's own, "room"
// for a room's, "gate" for a way that can be worked, "keyed" for one that can
// be held open.
//
// `character` needs { id, locationId, role: { slug }, tags: [{ tag: { slug } }] }.
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

  // A room's buttons, for every room this character can actually get into —
  // a locked door offers nothing, which is the same answer Discord gives by
  // simply not showing them the thread.
  const open = accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);
  for (const room of open) {
    for (const entry of roomAffordances(room)) {
      out.push({ ...entry, kind: "room", roomName: room.name });
    }
  }

  // The gates. Reaching the watchtower IS the permission — the winch is in
  // the tower, so anyone the tower's `access:` list lets in may work it, on
  // either face. There is no second opener predicate to disagree with the
  // room.
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

  // A keyed door is not a gate: it has no winch and no button on any anchor.
  // It offers one thing, and only to whoever holds its key — leave it propped
  // for a day. Already-held ways are listed so the panel can say so rather
  // than offering a click that refuses.
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
  PLAIN,
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
  LOCATION_AFFORDANCES,
  ROOM_AFFORDANCES,
  locationAffordances,
  roomAffordances,
  gateLabel,
  affordancesFor,
};
