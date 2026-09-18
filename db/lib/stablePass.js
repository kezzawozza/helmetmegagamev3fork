// The Stable's whole lifecycle (docs/systemdocs/ARELITZ.md §4-5), run once
// per `Room.stable` room from db/index.js#resolveNeeds(), right after
// structureYield and for the same reason the old arelitzLayPass.js sat
// there — an egg lands on the stable's OWN floor, so this must not run
// before "carry"'s own overflow drop might already be putting something on
// it. Replaces arelitzLayPass.js and horseUpkeepPass.js outright (ARELITZ.md):
// arelitz need no food upkeep, and lay through this pass instead of that one.
//
// Four steps, strictly in this order, all inside ONE transaction per room:
//   1. Age the brood, oldest rung first.
//   2. Feed the adults (cheapest food first) and lay an egg per adult fed.
//   3. Hatch what's sitting on the floor.
//   4. Evict past capacity.
//
// Deliberately not structureYieldPass's shape (a per-Structure claim row) —
// like arelitzLayPass.js before it, this sits behind the ordinary
// `done.has("arelitzLay")` guard in db/index.js, which is all the
// idempotency a once-a-turn pass over a handful of Rooms needs.
const { addToStack, addToRoomStack, dropRoomTag, lockRoom } = require("./tagWrites");
const { foodHungerFor } = require("./hunger");
const { getGameConfig } = require("./gameState");
const {
  ARELITZ_SLUG,
  UNRULY_ARELITZ_SLUG,
  ARELITZ_HATCHLING_SLUG,
  ARELITZ_YOUNGLING_SLUG,
  ARELITZ_YEARLING_SLUG,
  ARELITZ_EGG_SLUG,
  STABLE_CAPACITY,
  HATCH_IN,
} = require("./constants");

const ADULT_SLUGS = [ARELITZ_SLUG, UNRULY_ARELITZ_SLUG];
const BROOD_SLUGS = [ARELITZ_HATCHLING_SLUG, ARELITZ_YOUNGLING_SLUG, ARELITZ_YEARLING_SLUG];
const ALL_STABLE_SLUGS = [...ADULT_SLUGS, ...BROOD_SLUGS, ARELITZ_EGG_SLUG];

// Each independently 1-in-HATCH_IN, same reasoning as db/lib/soilery.js#reap:
// real per-unit variance, not a rounded average.
function hatchCount(eggs, rng = Math.random) {
  let hatched = 0;
  for (let i = 0; i < eggs; i++) {
    if (Math.floor(rng() * HATCH_IN) === 0) hatched++;
  }
  return hatched;
}

// Drains `need` units off the front of a cheapest-first inventory, mutating
// it in place. Returns null (and leaves the inventory untouched by the
// caller's own bookkeeping) if the inventory can't cover the whole need —
// the doc's "if possible" is all-or-nothing per adult, not a partial meal.
function takeFood(inventory, need) {
  if (inventory.reduce((s, r) => s + r.remaining, 0) < need) return null;
  const taken = [];
  let left = need;
  for (const row of inventory) {
    if (left <= 0) break;
    if (row.remaining <= 0) continue;
    const take = Math.min(row.remaining, left);
    taken.push({ tagId: row.tagId, quantity: take });
    row.remaining -= take;
    left -= take;
  }
  return taken;
}

async function runStablePass(prisma, turn) {
  const [rooms, tags, config] = await Promise.all([
    prisma.room.findMany({ where: { stable: true }, select: { id: true, name: true } }),
    prisma.tag.findMany({ where: { slug: { in: ALL_STABLE_SLUGS } }, select: { id: true, slug: true } }),
    getGameConfig(prisma),
  ]);
  if (!rooms.length) return { turnNumber: turn.number, fed: 0, laid: 0, hatched: 0, matured: 0, evicted: 0 };
  const idBySlug = new Map(tags.map((t) => [t.slug, t.id]));
  for (const slug of ALL_STABLE_SLUGS) {
    if (!idBySlug.has(slug)) {
      console.error(`Stable pass skipped: missing tag "${slug}" — run npm run db:sync-tags.`);
      return null;
    }
  }
  const capacity = config.stableCapacity ?? STABLE_CAPACITY;
  const overflowRoom = config.stableOverflowRoomSlug
    ? await prisma.room.findUnique({ where: { slug: config.stableOverflowRoomSlug }, select: { id: true } })
    : null;

  let fed = 0;
  let laid = 0;
  let hatched = 0;
  let matured = 0;
  let evicted = 0;

  for (const room of rooms) {
    await prisma.$transaction(async (tx) => {
      await lockRoom(tx, room.id);
      const rows = await tx.roomTag.findMany({
        where: { roomId: room.id },
        select: {
          tagId: true,
          quantity: true,
          createdAt: true,
          tag: { select: { slug: true, mealHunger: true, cooked: true, consumesInto: true } },
        },
      });
      const countOf = (slug) => rows.find((r) => r.tag.slug === slug)?.quantity ?? 0;

      // 1. Age the brood, oldest rung first — a hatchling this same pass adds
      // in step 3 can never climb more than one rung, since step 3 runs after
      // this one and reads nothing it wrote.
      const yearlings = countOf(ARELITZ_YEARLING_SLUG);
      const younglings = countOf(ARELITZ_YOUNGLING_SLUG);
      const hatchlings = countOf(ARELITZ_HATCHLING_SLUG);
      if (yearlings > 0) {
        await dropRoomTag(tx, room.id, idBySlug.get(ARELITZ_YEARLING_SLUG), yearlings);
        await addToRoomStack(tx, room.id, idBySlug.get(UNRULY_ARELITZ_SLUG), yearlings);
        matured += yearlings;
      }
      if (younglings > 0) {
        await dropRoomTag(tx, room.id, idBySlug.get(ARELITZ_YOUNGLING_SLUG), younglings);
        await addToRoomStack(tx, room.id, idBySlug.get(ARELITZ_YEARLING_SLUG), younglings);
      }
      if (hatchlings > 0) {
        await dropRoomTag(tx, room.id, idBySlug.get(ARELITZ_HATCHLING_SLUG), hatchlings);
        await addToRoomStack(tx, room.id, idBySlug.get(ARELITZ_YOUNGLING_SLUG), hatchlings);
      }

      // 2. Feed and lay. Every adult on the floor counts — "each arelitz
      // located in the stable," not only the broken-in ones. `+ yearlings`
      // because `countOf` still reads the PRE-step-1 snapshot (`rows`,
      // fetched once above) — a yearling that just matured this same pass
      // is exactly what step 1 added to unruly-arelitz, so it's added back
      // here rather than paying for a fresh query.
      const adultCount = countOf(ARELITZ_SLUG) + countOf(UNRULY_ARELITZ_SLUG) + yearlings;
      const foodInventory = rows
        .filter((r) => !ALL_STABLE_SLUGS.includes(r.tag.slug) && foodHungerFor(r.tag) > 0)
        .sort((a, b) => foodHungerFor(a.tag) - foodHungerFor(b.tag) || a.createdAt - b.createdAt)
        .map((r) => ({ tagId: r.tagId, remaining: r.quantity }));
      const consumedByTag = new Map();
      let eggsLaid = 0;
      for (let i = 0; i < adultCount; i++) {
        const taken = takeFood(foodInventory, 2);
        if (!taken) break; // "if possible" — the floor is out of food, done for this turn.
        for (const { tagId, quantity } of taken) {
          consumedByTag.set(tagId, (consumedByTag.get(tagId) ?? 0) + quantity);
        }
        eggsLaid += 1;
      }
      for (const [tagId, quantity] of consumedByTag) {
        await dropRoomTag(tx, room.id, tagId, quantity);
      }
      if (eggsLaid > 0) {
        await addToRoomStack(tx, room.id, idBySlug.get(ARELITZ_EGG_SLUG), eggsLaid);
        fed += eggsLaid;
        laid += eggsLaid;
      }

      // 3. Hatch what's on the floor — the room's OWN egg count, re-read
      // rather than reused from step 2's `rows` snapshot, since step 2 may
      // just have added to it.
      const eggRow = await tx.roomTag.findUnique({
        where: { roomId_tagId: { roomId: room.id, tagId: idBySlug.get(ARELITZ_EGG_SLUG) } },
        select: { quantity: true },
      });
      const eggCount = eggRow?.quantity ?? 0;
      const newHatchlings = eggCount > 0 ? hatchCount(eggCount) : 0;
      if (newHatchlings > 0) {
        await dropRoomTag(tx, room.id, idBySlug.get(ARELITZ_EGG_SLUG), newHatchlings);
        await addToRoomStack(tx, room.id, idBySlug.get(ARELITZ_HATCHLING_SLUG), newHatchlings);
        hatched += newHatchlings;
      }

      // 4. Evict past capacity — brood first (youngest rung first), then
      // unruly, then broken-in last (somebody's property, shoved out last).
      if (!overflowRoom) return;
      const finalCounts = new Map();
      for (const slug of ADULT_SLUGS.concat(BROOD_SLUGS)) {
        const row = await tx.roomTag.findUnique({
          where: { roomId_tagId: { roomId: room.id, tagId: idBySlug.get(slug) } },
          select: { quantity: true },
        });
        finalCounts.set(slug, row?.quantity ?? 0);
      }
      let total = 0;
      for (const n of finalCounts.values()) total += n;
      let excess = total - capacity;
      if (excess <= 0) return;
      const evictionOrder = [
        ARELITZ_HATCHLING_SLUG,
        ARELITZ_YOUNGLING_SLUG,
        ARELITZ_YEARLING_SLUG,
        UNRULY_ARELITZ_SLUG,
        ARELITZ_SLUG,
      ];
      for (const slug of evictionOrder) {
        if (excess <= 0) break;
        const have = finalCounts.get(slug) ?? 0;
        const take = Math.min(have, excess);
        if (take <= 0) continue;
        await dropRoomTag(tx, room.id, idBySlug.get(slug), take);
        await addToRoomStack(tx, overflowRoom.id, idBySlug.get(slug), take);
        excess -= take;
        evicted += take;
      }
    });
  }

  return { turnNumber: turn.number, fed, laid, hatched, matured, evicted };
}

module.exports = { runStablePass, hatchCount };
