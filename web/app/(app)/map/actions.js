"use server";

import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { crossingCheck, travelOptions, routesWithinZone } from "@lifeweb/db/lib/locationGraph";
import { heldReasonFor } from "@lifeweb/db/lib/intercept";
import { recordArrival, knownLocations } from "@lifeweb/db/lib/locationVisits";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { conversationsFor } from "@lifeweb/db/lib/conversations";
import { blocksOnFoot, equippedSlugs } from "@lifeweb/db/lib/mounts";
import { parksMounts } from "@lifeweb/db/lib/locationAttributes";
import {
  ESCORT_SELECT as MOVER_SELECT,
  partyOf,
} from "@lifeweb/db/lib/escort";
import {
  freeMovesLeft,
  freeZoneMovesReason,
  exertRefusal,
  exertEdgeFor,
  exertEdgeSentence,
} from "@lifeweb/db/lib/locationTravel";
import { nodeAt, plateSize, PLATE_SRC } from "@/lib/mapNodes";
import { zoneKey } from "@/lib/zones";

// The map's one loader (/map and the /chat overlay both call it). THE FOG IS
// REAL, NOT CSS: an unknown Location is absent from the payload entirely,
// since a server action is a public endpoint and anything shipped is shipped
// to the player (MAP.md §2a). Travel itself is NOT here — moving stays with
// travelTo on /chat, so there is one mover and one set of rules.

// A zone is underground if it is a cave LEVEL; the CAVE_GROUP parent
// ("Underground") is a category and never carries a Location.
function layerOfZone(zone) {
  return zone?.kind === "CAVE_LEVEL" ? "under" : "surface";
}

// Customs draws on both layers — the threshold, so the way underground doesn't start nowhere.
const BOTH_LAYERS = new Set(["customs"]);

export async function loadMap() {
  const session = await auth();
  if (!session?.discordUserId) return { ok: false, error: "You are not signed in." };

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: MOVER_SELECT,
  });

  // A GM with no living character reads the whole plate; a GM playing somebody gets their character's fogged map like anyone else.
  if (!character) {
    const { isGm } = await getGmSession();
    if (!isGm) return { ok: false, error: "You have no living character." };
    return buildMap({ character: null, unfogged: true });
  }

  // Self-healing: applyLocationMoveSideEffects's post-commit write can drop, so re-recording here closes that gap.
  if (character.locationId) {
    await recordArrival(prisma, character, character.locationId).catch(() => {});
  }

  return buildMap({ character, unfogged: false });
}

async function buildMap({ character, unfogged }) {
  const { width, height } = plateSize();

  const [locations, links, config, openTurn, currentZone] = await Promise.all([
    prisma.location.findMany({
      where: { retiredAt: null },
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
  // Whether the Move is spent — a push on is only offered after it is
  // (MAP.md §3). The same read the Travel panel and the sheet make.
  const acted =
    character && openTurn
      ? Boolean(await prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id }, select: { id: true } }))
      : false;

  const known = character
    ? await knownLocations(prisma, character.id)
    : { stood: new Set(), seen: new Set() };

  // Same call the Travel panel makes, so the two never disagree about a hop.
  const neighbours = character?.locationId ? await travelOptions(prisma, character, character.locationId) : [];
  const adjacent = new Map(neighbours.map((row) => [row.location.id, row]));

  // Everywhere in their own zone they could WALK to (MAP.md §3c). Fed the very
  // set `visible()` below reads, so a walkable node is always one the board was
  // already drawing — no new row ships, and the fog rule of §6b is untouched.
  const walks = character?.locationId
    ? await routesWithinZone(prisma, character, { known: known.seen })
    : [];
  const walkTo = new Map(walks.map((row) => [row.location.id, row]));

  const party = character ? await partyOf(prisma, character.id) : [];

  // Only places they have stood — a room is a door you must have stood in front of.
  const inside = await roomsInside(prisma, character, unfogged, known.stood);

  const tagSlugs = new Set((character?.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean));
  const onFootBlocked = blocksOnFoot(equippedSlugs(character?.tags ?? []));
  // One clock for the whole graph, so a way can't lapse halfway through the loop.
  const now = new Date();

  const visible = (id) => unfogged || known.seen.has(id) || adjacent.has(id);

  const nodes = [];
  for (const location of locations) {
    if (!visible(location.id)) continue;
    // Not drawn if never measured onto the plate.
    const at = nodeAt(location.slug);
    if (!at) continue;

    const here = Boolean(character?.locationId && location.id === character.locationId);
    const near = adjacent.get(location.id) ?? null;
    const walk = walkTo.get(location.id) ?? null;
    const stood = unfogged || known.stood.has(location.id);
    // THIS crossing's own count, not a flat one shared by every node — a
    // boat's bonus is earned per crossing (db/lib/mounts.js#boatCrossing),
    // so Forest<->Hills or Hills<->Marshes shows one more than a crossing
    // the water does nothing for. Only worth asking for an adjacent node;
    // a merely-known one has no crossing to weigh yet.
    const crossing = { fromZoneSlug: currentZone?.slug ?? null, toZoneSlug: location.zone?.slug ?? null };
    const freeLeft = near ? freeMovesLeft(character, config, openTurn, party.length, crossing) : null;
    // The server's own refusal of a push on here, asked ahead of time
    // (MAP.md §3); null is yes. Same question the Travel panel asks per
    // option, and the reason is shown once the Move is spent and this was
    // the only way across.
    const exertWhy = near?.crossesZone
      ? exertRefusal(character, config, openTurn, { crossing, left: freeLeft, acted })
      : null;

    nodes.push({
      id: location.id,
      slug: location.slug,
      name: location.name,
      zoneName: location.zone?.name ?? null,
      zoneKey: zoneKey(location.zone?.name) ?? "none",
      x: at.x,
      y: at.y,
      layer: layerOfZone(location.zone),
      both: BOTH_LAYERS.has(location.slug),
      state: here ? "here" : stood ? "stood" : "seen",
      // `near.passable`, NOT `near`: a locked/shut way is visible but blocked,
      // and its description stays hidden until it's actually open.
      description: stood || near?.passable ? location.description || null : null,
      // Rooms/conversations only where actually stood — see roomsInside().
      inside: inside.get(location.id) ?? null,
      indoors: parksMounts(location),
      adjacent: Boolean(near),
      passable: Boolean(near?.passable),
      // Reachable on foot inside this zone, through places they already know.
      // The board's Go reads this as well as `passable`; the DOUBLE-CLICK reads
      // it and nothing else, which is what keeps a gesture off every crossing.
      walkable: Boolean(walk),
      walkHops: walk?.hops ?? null,
      // The stops on the way, named before they commit — the guard that makes
      // the gesture safe (MAP.md §6c). Never the destination itself.
      walkThrough: walk ? walk.path.slice(0, -1).map((l) => l.name) : null,
      // A narrow way somewhere along the road would take their horse off them.
      walkDismounts: Boolean(walk?.dismounts),
      crossesZone: Boolean(near?.crossesZone),
      freeLeft,
      // Whether Push on belongs on the card for this crossing (MAP.md §3).
      canExert: Boolean(near?.crossesZone && exertWhy === null),
      exertWhy,
      // Which way the push on's die leans, said before they commit. Null when
      // it doesn't; the same sentence the Travel panel carries.
      exertNote: near?.crossesZone ? exertEdgeSentence(exertEdgeFor(character?.tags ?? [])) : null,
      dismounts: Boolean(near?.dismounts),
      reason: near?.refusal ?? null,
      // Same field the Travel panel draws a chip from; only ever set for a tag this character already holds.
      openedBy: near?.openedBy ?? null,
    });
  }

  const shown = new Set(nodes.map((n) => n.id));

  // Draws only when both ends are known AND the way is LISTED (MAP.md §2a):
  // `listed` is weaker than `passable`, so a locked door draws dashed but a hidden crawl draws nothing.
  const edges = [];
  for (const link of links) {
    if (!shown.has(link.aId) || !shown.has(link.bId)) continue;
    const verdict = crossingCheck(link, { tagSlugs, onFootBlocked, now });
    // The GM sees every way; only the `listed` filter is lifted.
    if (!unfogged && !verdict.listed) continue;
    edges.push({
      a: link.aId,
      b: link.bId,
      gate: gateOf(link, verdict),
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
          held: heldReasonFor(character),
          freeLeft: freeMovesLeft(character, config, openTurn, party.length),
          freeReason: freeZoneMovesReason(character, party.length, { config, openTurn }),
          mounted: onFootBlocked,
          partySize: party.length,
          // The Move already spent this turn: Go leaves the card and the push
          // on is the only way across a zone with no travel left (MAP.md §3).
          moved: acted,
        }
      : null,
    known: nodes.length,
    total: locations.length,
  };
}

// Public rooms, private rooms they may enter, and their own conversations.
// Private filter is accessibleRooms(), the SAME predicate the channel doctor,
// Secret rooms? and Transfer use — no second copy of that rule here.
async function roomsInside(prisma, character, unfogged, stoodIds) {
  const ids = unfogged ? undefined : [...stoodIds];
  if (!unfogged && ids.length === 0) return new Map();

  const [rooms, keys, conversations] = await Promise.all([
    prisma.room.findMany({
      where: { retiredAt: null, ...(ids ? { locationId: { in: ids } } : {}) },
      select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    character ? roomAccessKeys(prisma, character.id) : null,
    character ? conversationsFor(prisma, character.id) : [],
  ]);

  const allowed = unfogged
    ? rooms
    : accessibleRooms(rooms, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds);

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

// What to draw the line as. Only states a player can DO something about get a mark.
function gateOf(link, verdict) {
  if (verdict.passable) return null;
  if (link.modular && !link.isOpen) return "shut";
  if (link.requiredTagSlug) return "locked";
  return "closed";
}
