// The Pointer Device Kit's pair: two runtime-minted Tag rows that always
// point at each other. Modelled on db/lib/photoMint.js almost line for line —
// the sixth runtime authoring door, alongside docs/tags.yaml, the GM form,
// the corpse/headstone/crate minters, paperMint.js and photoMint.js. Every
// row carries `custom: true` (db:sync-tags never sees it, db:prune-tags
// skips it) and `ephemeral: true` (a Restart Game sweeps it up).
//
// Deliberately NOT mintCustomCraft — that function dedups on
// name+description+cookedFrom, and both halves of a pair share the exact
// same name and description on purpose. A second call with identical
// arguments would hand back the FIRST row again instead of minting a
// second, so this is its own small mint instead.
//
// A pair is found by slug alone: `custom-pointer-<code>-a` and
// `custom-pointer-<code>-b`, never a schema column — the same "find a
// runtime-minted row by slug prefix" idiom db/lib/disguiseMint.js already
// uses. `<code>` is a random 3-digit number, retried on collision against
// BOTH halves at once (a single-slug retry, the kind createWithRetry does,
// cannot check two slugs together) — the same posture noteCode()/
// shipmentId() take elsewhere in this codebase: a plain random code, not a
// monotonic counter, because nothing here needs global ordering.
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays off the @lifeweb/db barrel.
const { createWithRetry } = require("./paperMint");
const { addToStack } = require("./tagWrites");

const POINTER_SLUG_PREFIX = "custom-pointer-";
const POINTER_DESCRIPTION =
  "An old, bulky handheld device with an arrow. Held parallel to the ground, it points at its partner.";

function pointerSlug(code, half) {
  return `${POINTER_SLUG_PREFIX}${code}-${half}`;
}

// Whether a slug names one of these — the gate a sheet button checks, and
// the same test the reader uses to confirm what it just loaded really is a
// pointer device rather than something else entirely that happens to match.
function isPointerDeviceSlug(slug) {
  return typeof slug === "string" && slug.startsWith(POINTER_SLUG_PREFIX);
}

// "155-A" swaps to "155-B" and back — the whole "find the other one" query
// starts here. Null for anything that isn't a pointer device slug.
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

// ** Hands `db` the TOP-LEVEL client, never a transaction. ** Postgres
// aborts a whole transaction the moment one statement in it fails, so a
// catch-and-retry inside $transaction can only raise 25P02 on the second
// try. Callers grant the finished rows inside their own transaction instead
// (attachPointerPair, below), the same split photoMint.js's mintPhoto and
// consumeTagRequestImpl's photographNothingImpl already use.
//
// `baseTag` is the Pointer Device Kit's own catalog row — its category,
// group, weight and stackability (false: two devices are two objects, not
// one stack of two) carry over to both halves.
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
      // The "a" half minted but "b" lost the race — never leave an orphan
      // half sitting in the catalog for nobody to ever hold.
      await db.tag.delete({ where: { id: a.id } }).catch(() => {});
      continue;
    }
    return { a, b, code };
  }
  throw new Error("Couldn't mint a free pointer pair — try again.");
}

// Puts both halves into one character's hands — they bought a KIT of two, to
// hand one away later via ordinary Transfer. Safe inside a transaction.
async function attachPointerPair(tx, ownerId, pair) {
  await addToStack(tx, ownerId, pair.a.id, 1, {});
  await addToStack(tx, ownerId, pair.b.id, 1, {});
  return pair;
}

// Where the OTHER half of a pair physically is, as a locationId, or null if
// it is nowhere the map can name — same three-home shape db/lib/nuke.js's
// deviceLocationId walks (a character's sheet, a room stash, or inside a
// crate's JSON contents, which no `where: { tagId }` can find directly),
// written fresh here rather than imported so this stays fully separate from
// that secret plot's own code.
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
