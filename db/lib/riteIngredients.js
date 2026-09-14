// What a rite needs, judged against the room (docs/systemdocs/THANATI.md §4). Two kinds of ingredient. FLOOR kinds — `{ tag, count }` stacks and
// `{ resources }` — are read off the room's stash and consumed by the sweep. RESOLVED kinds — bound-person, corpse, photograph, weapon — are found
// here rather than eaten, so the chant hook, sweep and effect all agree which one (bound-person: a living Bound character at the Location who can
// get into this room, leaders first; corpse: a corpse tag with the dead character it's a handle to; photograph: on the floor first or in a
// participant's hands, resolved to who it pictures; weapon: a random weapon stack). Per-rite constraints (Conversion/Judgement/Madness/Fulfillment/
// Ascension) live here too, since the sweep consumes the floor BEFORE the handler runs — a refusal from inside an effect would already have eaten it.
const { floorIngredients } = require("./rites");
const { accessibleRooms, roomAccessKeys } = require("./roomAccess");
const { THANATI_SLUG, THANATI_LEADER_SLUG } = require("./thanati");

const BOUND_SLUG = "bound";
const PIOUS_SLUG = "pious";
const WEAPON_GROUP_SLUG = "items-weapons";
// A slug list rather than a Location attribute, so it needs no zone sync.
const HALLOWED_LOCATION_SLUGS = Object.freeze(["cathedral"]);

function pick(list) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// The rites that pick a target off a photograph and refuse a Pious one, or one on hallowed ground.
const HALLOWED_PROOF_RITES = new Set(["judgement", "madness"]);

function onHallowedGround(location) {
  return Boolean(location?.slug && HALLOWED_LOCATION_SLUGS.includes(location.slug));
}

// The floor half. `room` needs { id }.
async function floorHas(db, rite, roomId) {
  const needs = floorIngredients(rite);
  if (needs.length === 0) return true;
  const room = await db.room.findUnique({
    where: { id: roomId },
    select: { resources: true, tags: { select: { quantity: true, tag: { select: { slug: true } } } } },
  });
  if (!room) return false;
  const stacks = new Map(room.tags.map((t) => [t.tag.slug, t.quantity]));
  for (const need of needs) {
    if (need.resources && room.resources < need.resources) return false;
    if (need.tag && (stacks.get(need.tag) ?? 0) < (need.count ?? 1)) return false;
  }
  return true;
}

// Living Bound characters at the Location who can get into this room. `room`
// needs { id, kind, locationId, accessTagSlugs }.
async function boundCandidates(db, room, { excludeSlugs = [] } = {}) {
  const rows = await db.character.findMany({
    where: {
      status: "ALIVE",
      locationId: room.locationId,
      tags: { some: { quantity: { gt: 0 }, tag: { slug: BOUND_SLUG } } },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      age: true,
      gender: true,
      discordUserId: true,
      discordRoleId: true,
      locationId: true,
      zoneId: true,
      role: { select: { requiresWhitelist: true } },
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
    },
  });
  const out = [];
  for (const c of rows) {
    const slugs = new Set(c.tags.map((ct) => ct.tag.slug));
    if (excludeSlugs.some((slug) => slugs.has(slug))) continue;
    const keys = await roomAccessKeys(db, c.id);
    if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) continue;
    out.push({ ...c, slugs, leader: Boolean(c.role?.requiresWhitelist) });
  }
  return out.sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name));
}

// A corpse on this floor with a dead character behind it.
async function corpseOnFloor(db, roomId) {
  const rows = await db.roomTag.findMany({
    where: { roomId, quantity: { gt: 0 }, tag: { corpseOfCharacterId: { not: null } } },
    select: { tagId: true, tag: { select: { id: true, name: true, corpseOfCharacterId: true } } },
  });
  for (const row of rows) {
    const dead = await db.character.findUnique({
      where: { id: row.tag.corpseOfCharacterId },
      select: { id: true, name: true, firstName: true, lastName: true, discordUserId: true, status: true, buriedAt: true, locationId: true, zoneId: true },
    });
    if (dead && dead.status === "DEAD") return { tag: row.tag, dead };
  }
  return null;
}

// "Photo (Name)" → "Name", for prints from before photoOfCharacterId existed.
function nameOnPhoto(tagName) {
  const m = /^Photo \((.+?)(?: · [A-Z]{2}-\d{4})?\)$/.exec(tagName ?? "");
  return m ? m[1] : null;
}

async function pictured(db, tag) {
  if (tag.photoOfCharacterId) {
    return db.character.findUnique({
      where: { id: tag.photoOfCharacterId },
      select: { id: true, name: true, discordUserId: true, discordRoleId: true, status: true, locationId: true, zoneId: true, tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } } },
    });
  }
  const name = nameOnPhoto(tag.name);
  if (!name) return null;
  // Two living characters may share a name, and an old print cannot say which: an ambiguous name resolves to nobody.
  const matches = await db.character.findMany({
    where: { name, status: "ALIVE" },
    take: 2,
    select: { id: true, name: true, discordUserId: true, discordRoleId: true, status: true, locationId: true, zoneId: true, tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } } },
  });
  return matches.length === 1 ? matches[0] : null;
}

// Photographs on the floor first, then in the participants' hands. Random among the floor's prints.
async function photographInReach(db, roomId, participants = []) {
  const photoWhere = { custom: true, OR: [{ photoOfCharacterId: { not: null } }, { name: { startsWith: "Photo (" } }] };
  const floor = await db.roomTag.findMany({
    where: { roomId, quantity: { gt: 0 }, tag: photoWhere },
    select: { tag: { select: { id: true, name: true, photoOfCharacterId: true } } },
  });
  const candidates = floor.map((r) => ({ holder: { kind: "room", id: roomId }, tag: r.tag }));
  // Hands are collected ALWAYS, not only when the floor is bare — "floor first" is a preference, not an exclusion. Floor is shuffled and searched first.
  if (participants.length) {
    const held = await db.characterTag.findMany({
      where: { characterId: { in: participants.map((p) => p.characterId) }, quantity: { gt: 0 }, tag: photoWhere },
      select: { characterId: true, tag: { select: { id: true, name: true, photoOfCharacterId: true } } },
    });
    for (const h of held) candidates.push({ holder: { kind: "character", id: h.characterId }, tag: h.tag });
  }
  // Shuffle each group in place, floor before hands.
  const shuffle = (list, from, to) => {
    for (let i = to - 1; i > from; i -= 1) {
      const j = from + Math.floor(Math.random() * (i - from + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  };
  shuffle(candidates, 0, floor.length);
  shuffle(candidates, floor.length, candidates.length);
  for (const c of candidates) {
    const target = await pictured(db, c.tag);
    if (target && target.status === "ALIVE") return { ...c, target };
  }
  return null;
}

async function weaponOnFloor(db, roomId) {
  const rows = await db.roomTag.findMany({
    where: { roomId, quantity: { gt: 0 }, tag: { group: { slug: WEAPON_GROUP_SLUG } } },
    select: { tag: true },
  });
  const row = pick(rows);
  return row ? row.tag : null;
}

// Everything a rite needs, or what is missing.
async function resolveIngredients(db, rite, room, { participants = [] } = {}) {
  const missing = [];
  const resolved = {};
  if (!(await floorHas(db, rite, room.id))) missing.push("floor");

  for (const need of rite.ingredients ?? []) {
    if (!need.kind) continue;
    if (need.kind === "bound-person") {
      const exclude = rite.key === "conversion" ? [PIOUS_SLUG, THANATI_SLUG] : [];
      const candidates = await boundCandidates(db, room, { excludeSlugs: exclude });
      if (candidates.length === 0) missing.push("bound-person");
      else resolved.boundPerson = candidates[0];
    } else if (need.kind === "corpse") {
      const corpse = await corpseOnFloor(db, room.id);
      if (!corpse) missing.push("corpse");
      else resolved.corpse = corpse;
    } else if (need.kind === "photograph") {
      const photo = await photographInReach(db, room.id, participants);
      if (!photo) missing.push("photograph");
      else resolved.photograph = photo;
    } else if (need.kind === "weapon") {
      const weapon = await weaponOnFloor(db, room.id);
      if (!weapon) missing.push("weapon");
      else resolved.weapon = weapon;
    }
  }

  // Judgement and Madness say the same thing in two spellings — one rule, not two.
  if (HALLOWED_PROOF_RITES.has(rite.key) && resolved.photograph) {
    const t = resolved.photograph.target;
    const slugs = new Set(t.tags.map((ct) => ct.tag.slug));
    const at = t.locationId
      ? await db.location.findUnique({ where: { id: t.locationId }, select: { slug: true } })
      : null;
    if (slugs.has(PIOUS_SLUG) || onHallowedGround(at)) missing.push("target");
  }

  // Fulfillment and Ascension have conditions the floor cannot express, checked HERE rather than in the handler since the sweep eats the floor
  // before the handler runs — a refusal upstairs rearms the attempt for free; a refusal downstairs would have swallowed the ingredients for nothing.
  if (rite.key === "fulfillment" || rite.key === "ascension") {
    const state = await db.gameState.findUnique({
      where: { id: 1 },
      select: {
        fulfillmentFiredAt: true,
        ascensionArmedTurn: true,
        // The fired stamp is on the Game row, not here (db/lib/turnBanner.js).
        game: { select: { ascensionFiredTurn: true } },
      },
    });
    if (rite.key === "fulfillment") {
      // The leader may walk in later, so a missing one is a rearm, not a failure.
      if (state?.fulfillmentFiredAt != null) missing.push("already-performed");
      const leaders = await db.character.count({
        where: {
          id: { in: participants.map((p) => p.characterId) },
          tags: { some: { quantity: { gt: 0 }, tag: { slug: THANATI_LEADER_SLUG } } },
        },
      });
      if (leaders === 0) missing.push("leader");
    } else {
      // The world can only end once PER GAME. The fired stamp comes off the Game row, not GameState, or a restart would leave the rite refusing
      // itself forever because the PREVIOUS world had already burned.
      if (state?.ascensionArmedTurn != null || state?.game?.ascensionFiredTurn != null) {
        missing.push("already-running");
      }
      // There has to be a leader to lose, or the rite would arm a countdown whose cancel condition is already true.
      const leaders = await db.character.count({
        where: { status: "ALIVE", tags: { some: { quantity: { gt: 0 }, tag: { slug: THANATI_LEADER_SLUG } } } },
      });
      if (leaders === 0) missing.push("leader");
    }
  }

  return { ok: missing.length === 0, missing, resolved };
}

module.exports = {
  BOUND_SLUG,
  HALLOWED_LOCATION_SLUGS,
  onHallowedGround,
  floorHas,
  resolveIngredients,
  nameOnPhoto,
};
