"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { crossingCheck, travelOptions } from "@lifeweb/db/lib/locationGraph";
import { heldReasonFor } from "@lifeweb/db/lib/intercept";
import { recordArrival, knownLocations } from "@lifeweb/db/lib/locationVisits";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { conversationsFor } from "@lifeweb/db/lib/conversations";
import { blocksOnFoot, equippedSlugs } from "@lifeweb/db/lib/mounts";
import { parksMounts, hasAttribute, SAFE_ATTRIBUTE } from "@lifeweb/db/lib/locationAttributes";
import {
  ESCORT_SELECT as MOVER_SELECT,
  partyOf,
} from "@lifeweb/db/lib/escort";
import { freeMovesLeft, freeZoneMovesReason } from "@lifeweb/db/lib/locationTravel";
import { nodeAt, plateSize, PLATE_SRC } from "@/lib/mapNodes";
import { zoneKey } from "@/lib/zones";

// The map's one loader. Both surfaces call it — the /map route and the overlay
// on /chat — so the fog is computed in exactly one place.
//
// THE FOG IS REAL, NOT CSS. A Location this character does not know is absent
// from the payload entirely rather than sent and hidden: a server action is a
// public endpoint, and anything shipped to the browser is shipped to the
// player. The same goes for edges — a hidden crawl somebody lacks the tag for
// is indistinguishable here from no edge at all, which is the wording rule
// crossingCheck already enforces on refusals (MAP.md §2a).
//
// Travel itself is NOT here. Moving stays with travelTo on /chat, so there is
// one mover and one set of rules; this only says what a hop would cost, using
// the same numbers the Travel panel does.

// A zone is underground if it is a cave LEVEL. Caves and Depths are the two;
// their CAVE_GROUP parent ("Underground") is a category and a GM seat, never a
// place, so it never carries a Location and never appears here.
function layerOfZone(zone) {
  return zone?.kind === "CAVE_LEVEL" ? "under" : "surface";
}

// Customs is a Caves Location whose building is drawn on the surface plate. It
// is the threshold between the two layers, so it draws on both — otherwise the
// way underground appears to start nowhere.
const BOTH_LAYERS = new Set(["customs"]);

export async function loadMap() {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, error: "You are not signed in." };

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: MOVER_SELECT,
  });

  // A GM with no living character reads the whole plate. They are running the
  // game; a fogged map would be a tool that hides the thing it is for. A GM
  // who IS playing somebody gets their character's map like anyone else —
  // /map sits in the player half of the rail, not the job half.
  if (!character) {
    const { isGm } = await getGmSession();
    if (!isGm) return { ok: false, error: "You have no living character." };
    return buildMap({ character: null, unfogged: true });
  }

  // Self-healing. applyLocationMoveSideEffects records every arrival, but it
  // runs post-commit and every caller swallows its errors, so a dropped write
  // would leave a permanent hole. Re-recording where they stand on every open
  // costs one upsert and closes that gap.
  if (character.locationId) {
    await recordArrival(prisma, character, character.locationId).catch(() => {});
  }

  return buildMap({ character, unfogged: false });
}

async function buildMap({ character, unfogged }) {
  const { width, height } = plateSize();

  const [locations, links, config, openTurn, currentZone] = await Promise.all([
    prisma.location.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        indoors: true,
        attributes: true,
        zone: { select: { slug: true, name: true, kind: true } },
      },
    }),
    prisma.locationLink.findMany(),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    character?.zoneId ? prisma.zone.findUnique({ where: { id: character.zoneId }, select: { slug: true } }) : null,
  ]);

  const known = character
    ? await knownLocations(prisma, character.id)
    : { stood: new Set(), seen: new Set() };

  // Where they can go from here, already gated and costed — the same call the
  // Travel panel makes, so the two can never disagree about a hop. Somebody
  // being held is asked too: travelOptions shuts every way and writes the
  // reason onto each row, so the board still draws instead of going blank.
  const neighbours = character?.locationId ? await travelOptions(prisma, character, character.locationId) : [];
  const adjacent = new Map(neighbours.map((row) => [row.location.id, row]));

  const party = character ? await partyOf(prisma, character.id) : [];

  // What is INSIDE the places they have been. Only those: a room is a door in
  // a wall you have to have stood in front of, and listing the Cathedral's
  // private rooms to somebody who has only glimpsed it from the Square would
  // be telling them about a door they have never seen.
  const inside = await roomsInside(prisma, character, unfogged, known.stood);

  const tagSlugs = new Set((character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  const onFootBlocked = blocksOnFoot(equippedSlugs(character?.tags ?? []));
  // One clock for the whole graph, so a propped-open way cannot lapse halfway
  // through the loop and draw open at one end and shut at the other.
  const now = new Date();

  const visible = (id) => unfogged || known.seen.has(id) || adjacent.has(id);

  const nodes = [];
  for (const location of locations) {
    if (!visible(location.id)) continue;
    // Placed on the art, or not drawn. A Location added to docs/zones.yaml but
    // never measured onto the plate would otherwise stack on the origin.
    const at = nodeAt(location.slug);
    if (!at) continue;

    const here = Boolean(character?.locationId && location.id === character.locationId);
    const near = adjacent.get(location.id) ?? null;
    const stood = unfogged || known.stood.has(location.id);

    nodes.push({
      id: location.id,
      slug: location.slug,
      name: location.name,
      zoneName: location.zone?.name ?? null,
      zoneKey: zoneKey(location.zone?.name) ?? "none",
      zoneSlug: location.zone?.slug ?? null,
      // A CAVE_LEVEL destination the Caving Die actually rolls at —
      // travelCost.js#crossingConfirm reads this to warn before a zone
      // crossing lands somebody underground (CAVING.md §2). Excludes Customs
      // and the Depot, the two `safe` Locations the Die skips (CAVING.md
      // §2a) — warning about a die that will not roll would be simply wrong.
      // Same field name as the /chat Travel panel's option
      // (chat/actions.js#loadTravel), so crossingConfirm reads one signal
      // regardless of which surface called it.
      caveLevel: location.zone?.kind === "CAVE_LEVEL" && !hasAttribute(location, SAFE_ATTRIBUTE),
      x: at.x,
      y: at.y,
      layer: layerOfZone(location.zone),
      both: BOTH_LAYERS.has(location.slug),
      state: here ? "here" : stood ? "stood" : "seen",
      // A place seen once from next door is a name and a colour. The
      // description is what standing there buys you — or what an open way out
      // is already telling you about where it leads.
      //
      // `near.passable`, NOT `near`: a locked door and a shut gate are ways
      // you can SEE and cannot use, and reading the room on the other side of
      // one is exactly the thing being locked out of it is supposed to
      // prevent. You get the name, the colour and the reason, and nothing
      // else until you get through.
      description: stood || near?.passable ? location.description || null : null,
      // Rooms and conversations only where they have actually stood — see
      // roomsInside(). Absent, not empty, everywhere else.
      inside: inside.get(location.id) ?? null,
      // The mount question, not the roof one: a Location you drive into is
      // drawn as an ordinary node (locationAttributes.js#parksMounts).
      indoors: parksMounts(location),
      adjacent: Boolean(near),
      passable: Boolean(near?.passable),
      crossesZone: Boolean(near?.crossesZone),
      // THIS crossing's own count, not a flat one shared by every node — a
      // boat's bonus is earned per crossing (db/lib/mounts.js#boatCrossing),
      // so Forest<->Hills or Hills<->Marshes shows one more than a crossing
      // the water does nothing for. Only worth asking for an adjacent node;
      // a merely-known one has no crossing to weigh yet.
      freeLeft: near
        ? freeMovesLeft(character, config, openTurn, party.length, {
            fromZoneSlug: currentZone?.slug ?? null,
            toZoneSlug: location.zone?.slug ?? null,
          })
        : null,
      dismounts: Boolean(near?.dismounts),
      reason: near?.refusal ?? null,
      // The tag of theirs that opens the way here, if one does. Same field the
      // Travel panel draws a chip from, and safe for the same reason: it is
      // only ever set for a tag this character already holds.
      openedBy: near?.openedBy ?? null,
    });
  }

  const shown = new Set(nodes.map((n) => n.id));

  // An edge draws only when both ends are known AND the way is LISTED for this
  // character. `listed` is weaker than `passable` (MAP.md §2a): a locked door
  // draws dashed and says why, a hidden crawl draws nothing at all and reads
  // exactly like two places with no way between them.
  const edges = [];
  for (const link of links) {
    if (!shown.has(link.aId) || !shown.has(link.bId)) continue;
    const verdict = crossingCheck(link, { tagSlugs, onFootBlocked, now });
    // The GM sees every way, including the ones no character could. Only the
    // `listed` filter is lifted — the verdict itself still decides how a way
    // is drawn, so a shut gate reads as shut on their board too.
    if (!unfogged && !verdict.listed) continue;
    edges.push({
      a: link.aId,
      b: link.bId,
      gate: gateOf(link, verdict),
      // Drawn as a solid accent line rather than a plain grey one: a road only
      // your own trait opens is worth seeing on the plate, not just in the card.
      openedBy: verdict.openedBy ?? null,
    });
  }

  const layers = ["surface"];
  if (nodes.some((n) => n.layer === "under")) layers.push("under");

  return {
    ok: true,
    plate: { src: PLATE_SRC, width, height },
    you: {
      locationId: character?.locationId ?? null,
      layer: layerOfZone(locations.find((l) => l.id === character?.locationId)?.zone),
      gm: unfogged,
    },
    layers,
    nodes,
    edges,
    travel: character
      ? {
          // Somebody has hold of them (INTERCEPT.md) — the banner over the
          // board. Every node's own refusal already says it too.
          held: heldReasonFor(character),
          freeLeft: freeMovesLeft(character, config, openTurn, party.length),
          freeReason: freeZoneMovesReason(character, party.length),
          mounted: onFootBlocked,
          partySize: party.length,
        }
      : null,
    known: nodes.length,
    total: locations.length,
  };
}

// What is inside each place the character has stood in: its public rooms, the
// private ones they may actually enter, and their own conversations there.
//
// Three separate lists rather than one, because they are three different kinds
// of thing — a public room is a place anyone can walk into, a private one is a
// door you hold the key to, and a conversation is people, not architecture.
//
// The private filter is accessibleRooms(), the SAME predicate the channel
// doctor, the Secret rooms? button and the Transfer dialog use, and it needs
// the guest ids as well as the tags or somebody let in by hand is shown no
// door at all. There is no second copy of that rule here.
async function roomsInside(prisma, character, unfogged, stoodIds) {
  const ids = unfogged ? undefined : [...stoodIds];
  if (!unfogged && ids.length === 0) return new Map();

  const [rooms, keys, conversations] = await Promise.all([
    prisma.room.findMany({
      where: ids ? { locationId: { in: ids } } : {},
      select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    character ? roomAccessKeys(prisma, character.id) : null,
    character ? conversationsFor(prisma, character.id) : [],
  ]);

  const allowed = unfogged
    ? rooms
    : accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds);

  const out = new Map();
  const at = (id) => {
    if (!out.has(id)) out.set(id, { public: [], private: [], conversations: [] });
    return out.get(id);
  };
  for (const id of ids ?? rooms.map((r) => r.locationId)) at(id);
  for (const room of allowed) {
    const bucket = at(room.locationId);
    (room.kind === "PRIVATE" ? bucket.private : bucket.public).push(room.name);
  }
  for (const thread of conversations) {
    if (!thread.locationId) continue;
    if (!unfogged && !stoodIds.has(thread.locationId)) continue;
    at(thread.locationId).conversations.push(thread.name || "A conversation");
  }
  return out;
}

// What to draw the line as. Only the two states a player can DO something
// about get a mark — a locked way sends you looking for the key, a shut one
// sends you to the winch. Everything else is just a road.
function gateOf(link, verdict) {
  if (verdict.passable) return null;
  if (link.modular && !link.isOpen) return "shut";
  if (link.requiredTagSlug) return "locked";
  return "closed";
}
