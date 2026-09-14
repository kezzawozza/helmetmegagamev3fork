// The Pointer Device Kit's pair: two runtime-minted Tag rows that always point at each other. Modelled on db/lib/photoMint.js. Every row carries
// `custom: true` (db:sync-tags/db:prune-tags skip it) and `ephemeral: true` (Restart Game sweeps it). Deliberately NOT mintCustomCraft — that dedups
// on name+description+cookedFrom, and both halves of a pair share the exact same name/description, so a second call would hand back the FIRST row.
// A pair is found by slug alone: `custom-pointer-<code>-a`/`-b`, the same "slug prefix" idiom db/lib/disguiseMint.js uses. `<code>` is a random
// 3-digit number, retried on collision against BOTH halves at once. Takes `prisma` (or a tx), stays off the @lifeweb/db barrel.
const { createWithRetry } = require("./paperMint");
const { addToStack } = require("./tagWrites");

const POINTER_SLUG_PREFIX = "custom-pointer-";
const POINTER_DESCRIPTION =
  "An old, bulky handheld device with an arrow. Held parallel to the ground, it points at its partner.";

function pointerSlug(code, half) {
  return `${POINTER_SLUG_PREFIX}${code}-${half}`;
}

// Whether a slug names one of these — the gate a sheet button checks.
function isPointerDeviceSlug(slug) {
  return typeof slug === "string" && slug.startsWith(POINTER_SLUG_PREFIX);
}

// "155-A" swaps to "155-B" and back. Null for anything that isn't a pointer device slug.
function partnerSlugOf(slug) {
  if (!isPointerDeviceSlug(slug)) return null;
  const rest = slug.slice(POINTER_SLUG_PREFIX.length);
  const match = /^(\d+)-(a|b)$/.exec(rest);
  if (!match) return null;
  const [, code, half] = match;
  return pointerSlug(code, half === "a" ? "b" : "a");
}

async function pointerGroupId(db, baseTag) {
  return baseTag?.groupId ?? null;
}

// ** Hands `db` the TOP-LEVEL client, never a transaction. ** Postgres aborts a whole transaction on one failed statement, so a catch-and-retry
// inside $transaction can only raise 25P02 on the second try. Callers grant the finished rows in their own transaction instead (attachPointerPair).
// `baseTag` is the Pointer Device Kit's own catalog row — its category, group, weight and stackability (false) carry over to both halves.
async function mintPointerPair(db, baseTag) {
  const groupId = await pointerGroupId(db, baseTag);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    const existing = await db.tag.findFirst({
      where: { slug: { in: [pointerSlug(code, "a"), pointerSlug(code, "b")] } },
      select: { id: true },
    });
    if (existing) continue;
    const shape = (half) => ({
      category: "items",
      groupId,
      name: "Pointer Device",
      description: POINTER_DESCRIPTION,
      pointCost: 0,
      custom: true,
      ephemeral: true,
      tradeable: true,
      weightLbs: baseTag?.weightLbs ?? 0.5,
      stackable: false,
      removable: true,
      purchasable: false,
      purchasableAfterStart: false,
      consumable: false,
    });
    const a = await createWithRetry(db, () => ({ ...shape("a"), slug: pointerSlug(code, "a") }));
    if (!a) continue;
    const b = await createWithRetry(db, () => ({ ...shape("b"), slug: pointerSlug(code, "b") }));
    if (!b) {
      // "a" minted but "b" lost the race — never leave an orphan half in the catalog.
      await db.tag.delete({ where: { id: a.id } }).catch(() => {});
      continue;
    }
    return { a, b, code };
  }
  throw new Error("Couldn't mint a free pointer pair — try again.");
}

// Puts both halves into one character's hands — a KIT of two, hand one away later via ordinary Transfer. Safe inside a transaction.
async function attachPointerPair(tx, ownerId, pair) {
  await addToStack(tx, ownerId, pair.a.id, 1, {});
  await addToStack(tx, ownerId, pair.b.id, 1, {});
  return pair;
}

// Where the OTHER half of a pair physically is, as a locationId, or null — same three-home shape as db/lib/nuke.js's deviceLocationId (a character's
// sheet, a room stash, or inside a crate's JSON contents), written fresh here to stay separate from that secret plot's own code.
async function locatePointerPartner(prisma, slug) {
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true } });
  if (!tag) return null;

  const held = await prisma.characterTag.findFirst({
    where: { tagId: tag.id, quantity: { gt: 0 }, character: { locationId: { not: null } } },
    select: { character: { select: { locationId: true } } },
  });
  if (held?.character?.locationId) return held.character.locationId;

  const stashed = await prisma.roomTag.findFirst({
    where: { tagId: tag.id, quantity: { gt: 0 } },
    select: { room: { select: { locationId: true } } },
  });
  if (stashed?.room?.locationId) return stashed.room.locationId;

  const crates = await prisma.tag.findMany({
    where: { crateContents: { not: null } },
    select: { id: true, crateContents: true },
  });
  const carrying = crates
    .filter((c) => Array.isArray(c.crateContents) && c.crateContents.some((line) => line?.tagId === tag.id))
    .map((c) => c.id);
  if (carrying.length === 0) return null;

  const crateHeld = await prisma.characterTag.findFirst({
    where: { tagId: { in: carrying }, quantity: { gt: 0 }, character: { locationId: { not: null } } },
    select: { character: { select: { locationId: true } } },
  });
  if (crateHeld?.character?.locationId) return crateHeld.character.locationId;

  const crateStashed = await prisma.roomTag.findFirst({
    where: { tagId: { in: carrying }, quantity: { gt: 0 } },
    select: { room: { select: { locationId: true } } },
  });
  return crateStashed?.room?.locationId ?? null;
}

module.exports = {
  POINTER_DEVICE_KIT_SLUG: "pointer-device-kit",
  isPointerDeviceSlug,
  partnerSlugOf,
  mintPointerPair,
  attachPointerPair,
  locatePointerPartner,
};
