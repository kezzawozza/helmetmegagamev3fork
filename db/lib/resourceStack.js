// Resources (⬢) as a physical stack, which is what they are since 9/2026.
//
// They used to be `Character.resources` / `Room.resources` — two Int columns
// holding a number nobody could pick up. They are a Tag now (`resources`, one
// pound a unit, docs/tags.yaml beside `obol`), held in the ordinary
// CharacterTag / RoomTag rows every other item lives in. That is the whole
// point: stashing, handing over, stealing, looting a corpse and setting down
// an overfull pack all stopped needing a ⬢-shaped special case the day the
// columns died, because they are just stack moves now.
//
// This module is the ONE place that knows a ⬢ balance is a stack row. Nothing
// else should reach for the tag by slug — the ledger's forms, the carry cap
// and the turn passes all go through the helpers here, so the storage can move
// again without another 500-site sweep.
//
// Takes `tx`/`prisma` as a parameter and stays OFF the @lifeweb/db barrel:
// db/index.js's turn engine imports this, so requiring the barrel back would
// resolve to a partial exports object (the db/lib/dm.js convention). Require
// it by path.

const RESOURCES_SLUG = "resources";

// What one ⬢ weighs. This MIRRORS `weight: 1` on the `resources` tag in
// docs/tags.yaml, which stays the source of truth — every weight actually
// charged against a carry cap is read off the Tag row like any other item's
// (db/lib/tagWeight.js). This constant exists for the one question a loaded
// row cannot answer: "what would N more ⬢ weigh", asked by
// db/lib/carry.js#carryAdmits BEFORE the units exist. db/lib/syncTags.js
// fails the sync if the catalog and this ever disagree.
const RESOURCES_WEIGHT_LBS = 1;

// The tag id, memoised the same way and for the same reason as
// db/lib/pricedTags.js: the turn passes ask for it once per character, and a
// findUnique per ask is a query per row at 100+ characters. A TTL rather than
// a permanent memo so a `db:sync-tags` run is picked up without a restart.
const TTL_MS = 5 * 60 * 1000;
let cachedId = null;
let loadedAt = 0;
let warnedMissing = false;

function invalidateResourcesTag() {
  cachedId = null;
  loadedAt = 0;
}

// Null when the catalog has no `resources` tag — which means db:sync-tags has
// not run. Every caller below treats that as "nobody holds any ⬢" rather than
// throwing, so a half-synced database degrades to a poor game instead of a
// 500 on every page; the console line says what to run.
async function resourcesTagId(tx) {
  if (cachedId && Date.now() - loadedAt < TTL_MS) return cachedId;
  const tag = await tx.tag.findUnique({ where: { slug: RESOURCES_SLUG }, select: { id: true } });
  if (!tag) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error(`No "${RESOURCES_SLUG}" tag — run npm run db:sync-tags. Every ⬢ balance will read 0.`);
    }
    return null;
  }
  cachedId = tag.id;
  loadedAt = Date.now();
  warnedMissing = false;
  return cachedId;
}

// --- Reading -------------------------------------------------------------

// A Prisma `select` fragment for a character/room that needs nothing about its
// tags EXCEPT the ⬢ count. Spread it into a select and read the result with
// `resourcesOf`. A caller already loading the whole tag set doesn't need this
// — `resourcesOf` reads that shape too.
const RESOURCES_SELECT = {
  tags: { where: { tag: { slug: RESOURCES_SLUG } }, select: { quantity: true } },
};

// The ⬢ on an already-loaded character or room row. Accepts either shape: a
// row selected with RESOURCES_SELECT (one filtered tag row), or a row that
// loaded its whole tag set with `tag: { slug }` included. Absent row means
// zero — an empty stack is deleted, never kept as a 0.
function resourcesOf(row) {
  const tags = row?.tags;
  if (!Array.isArray(tags) || !tags.length) return 0;
  const named = tags.find((ct) => ct?.tag?.slug === RESOURCES_SLUG);
  if (named) return named.quantity ?? 0;
  // Nothing carries a `tag` at all, so this was selected with
  // RESOURCES_SELECT — which filtered to the one row we want.
  if (tags.every((ct) => ct?.tag === undefined)) return tags[0]?.quantity ?? 0;
  // A full tag set that simply doesn't include Resources.
  return 0;
}

async function readCharacterResources(tx, characterId) {
  const tagId = await resourcesTagId(tx);
  if (!tagId || !characterId) return 0;
  const row = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId } },
    select: { quantity: true },
  });
  return row?.quantity ?? 0;
}

async function readRoomResources(tx, roomId) {
  const tagId = await resourcesTagId(tx);
  if (!tagId || !roomId) return 0;
  const row = await tx.roomTag.findUnique({
    where: { roomId_tagId: { roomId, tagId } },
    select: { quantity: true },
  });
  return row?.quantity ?? 0;
}

// Batch reads, for the desks and passes that hold a list of ids and would
// otherwise issue one query each. Returns a Map<id, number>; an id nobody
// holds ⬢ for is simply absent, so read it with `?? 0`.
async function resourcesByCharacterIds(tx, characterIds) {
  const ids = [...new Set((characterIds ?? []).filter(Boolean))];
  const tagId = await resourcesTagId(tx);
  if (!tagId || !ids.length) return new Map();
  const rows = await tx.characterTag.findMany({
    where: { tagId, characterId: { in: ids } },
    select: { characterId: true, quantity: true },
  });
  return new Map(rows.map((r) => [r.characterId, r.quantity ?? 0]));
}

async function resourcesByRoomIds(tx, roomIds) {
  const ids = [...new Set((roomIds ?? []).filter(Boolean))];
  const tagId = await resourcesTagId(tx);
  if (!tagId || !ids.length) return new Map();
  const rows = await tx.roomTag.findMany({
    where: { tagId, roomId: { in: ids } },
    select: { roomId: true, quantity: true },
  });
  return new Map(rows.map((r) => [r.roomId, r.quantity ?? 0]));
}

// The world's ⬢, for /gm/economy's supply figure. `characterWhere` scopes it
// the way the panel wants (ALIVE, or the holding statuses) without this module
// having an opinion about which.
async function sumCharacterResources(tx, characterWhere = {}) {
  const tagId = await resourcesTagId(tx);
  if (!tagId) return 0;
  const agg = await tx.characterTag.aggregate({
    where: { tagId, character: characterWhere },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

async function sumRoomResources(tx, roomWhere = {}) {
  const tagId = await resourcesTagId(tx);
  if (!tagId) return 0;
  const agg = await tx.roomTag.aggregate({
    where: { tagId, room: roomWhere },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

// --- Writing -------------------------------------------------------------
//
// Two shapes, and the difference matters:
//
//   addCharacterResources / addRoomResources — CLAMPED. A debit larger than
//     the balance takes what is there and destroys the shortfall, which is
//     what the old `GREATEST(0, ...)` raw SQL did and what the ledger books
//     as a CLAMP burn (docs/systemdocs/ECONOMY.md §4). Returns what actually
//     moved so the caller can record it.
//
//   takeCharacterResources / takeRoomResources — STRICT. Takes the whole
//     amount or nothing, and says which. This is the shape money wants: a
//     conditional write, never a read-then-decrement, because Prisma runs
//     READ COMMITTED and two concurrent spenders would both pass a separate
//     read (db/lib/resourceTransfer.js says the same thing at more length).

// A stack row is created on the way up and deleted on the way down to zero,
// exactly as tagWrites.js does it — a 0-quantity row left lying around would
// show up as "Resources ×0" in every tag rail and every Examine.
//
// `acquiredAt` is bumped on every top-up, and that is load-bearing rather than
// cosmetic: db/lib/carry.js#drawDrops sheds the NEWEST-acquired units first,
// so a stack frozen at the moment its first unit landed would be the last
// thing an overfull character put down no matter how much arrived since.
async function bumpStack(tx, { model, whereUnique, createData, delta }) {
  const existing = await tx[model].findUnique({ where: whereUnique, select: { id: true, quantity: true } });
  const before = existing?.quantity ?? 0;

  if (delta >= 0) {
    if (!delta) return { before, after: before, moved: 0 };
    if (existing) {
      // `increment`, not `before + delta` — the read above is for the return
      // value, and writing it back would lose a concurrent top-up.
      await tx[model].update({
        where: { id: existing.id },
        data: { quantity: { increment: delta }, ...(model === "characterTag" ? { acquiredAt: new Date() } : {}) },
      });
    } else {
      await tx[model].create({ data: { ...createData, quantity: delta } });
    }
    return { before, after: before + delta, moved: delta };
  }

  const want = -delta;
  const take = Math.min(before, want);
  if (!take) return { before, after: before, moved: 0, clamped: want };
  if (take === before) {
    await tx[model].delete({ where: { id: existing.id } });
  } else {
    await tx[model].update({ where: { id: existing.id }, data: { quantity: before - take } });
  }
  return { before, after: before - take, moved: -take, clamped: want - take };
}

async function addCharacterResources(tx, characterId, delta) {
  const tagId = await resourcesTagId(tx);
  if (!tagId || !characterId) return { before: 0, after: 0, moved: 0 };
  return bumpStack(tx, {
    model: "characterTag",
    whereUnique: { characterId_tagId: { characterId, tagId } },
    createData: { characterId, tagId, source: "EVENT" },
    delta: Math.trunc(delta ?? 0),
  });
}

async function addRoomResources(tx, roomId, delta) {
  const tagId = await resourcesTagId(tx);
  if (!tagId || !roomId) return { before: 0, after: 0, moved: 0 };
  return bumpStack(tx, {
    model: "roomTag",
    whereUnique: { roomId_tagId: { roomId, tagId } },
    createData: { roomId, tagId },
    delta: Math.trunc(delta ?? 0),
  });
}

// True when the whole `amount` came out, false when it did not and nothing
// moved. The conditional `updateMany` IS the balance check — see the header
// note on READ COMMITTED above.
async function takeCharacterResources(tx, characterId, amount) {
  const want = Math.max(0, Math.trunc(amount ?? 0));
  if (!want) return true;
  const tagId = await resourcesTagId(tx);
  if (!tagId || !characterId) return false;
  const { count } = await tx.characterTag.updateMany({
    where: { characterId, tagId, quantity: { gte: want } },
    data: { quantity: { decrement: want } },
  });
  if (!count) return false;
  await tx.characterTag.deleteMany({ where: { characterId, tagId, quantity: { lte: 0 } } });
  return true;
}

async function takeRoomResources(tx, roomId, amount) {
  const want = Math.max(0, Math.trunc(amount ?? 0));
  if (!want) return true;
  const tagId = await resourcesTagId(tx);
  if (!tagId || !roomId) return false;
  const { count } = await tx.roomTag.updateMany({
    where: { roomId, tagId, quantity: { gte: want } },
    data: { quantity: { decrement: want } },
  });
  if (!count) return false;
  await tx.roomTag.deleteMany({ where: { roomId, tagId, quantity: { lte: 0 } } });
  return true;
}

// Absolute set, for the GM surfaces that edit a sheet's ⬢ to a number rather
// than by a delta (web/lib/characterWrite.js, the Dev Panel's bulk "set").
async function setCharacterResources(tx, characterId, value) {
  const target = Math.max(0, Math.trunc(value ?? 0));
  const before = await readCharacterResources(tx, characterId);
  await addCharacterResources(tx, characterId, target - before);
  return { before, after: target };
}

module.exports = {
  RESOURCES_SLUG,
  RESOURCES_WEIGHT_LBS,
  RESOURCES_SELECT,
  resourcesTagId,
  invalidateResourcesTag,
  resourcesOf,
  readCharacterResources,
  readRoomResources,
  resourcesByCharacterIds,
  resourcesByRoomIds,
  sumCharacterResources,
  sumRoomResources,
  addCharacterResources,
  addRoomResources,
  takeCharacterResources,
  takeRoomResources,
  setCharacterResources,
};
