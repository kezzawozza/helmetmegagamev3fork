// Tag writes shared by both faces of the game — the bot's GM `/heal` command
// and every web/lib/tagEffects.js caller both go through these (which
// re-exports them), so a tag write is never implemented twice.
//
// Every function here takes a transaction client (`tx`) as its first
// parameter rather than reaching for the singleton, so a caller can compose
// it into a larger transaction — the db/lib/dm.js convention.
const { expiryFrom } = require("./turnFormat");
const { drawPoisonedUnits } = require("./poison");

// A wound landing on a sheet frightens its owner (docs/systemdocs/MOOD.md).
// Both creators below call this for the row they just made — a stack going up
// or an already-held tag is not a new wound, so only the `!existing` branches
// do. Required lazily: db/lib/mood.js is the module that owns the rule, and a
// top-level require here would be a cycle. Wrapped: a mood hiccup must never
// fail a tag write.
async function chargeWoundMood(tx, characterId, tagIds) {
  try {
    await require("./mood").applyWoundMood(tx, characterId, tagIds);
  } catch (err) {
    console.error(`Wound mood failed for ${characterId}:`, err.message ?? err);
  }
}

// Adds `quantity` of a tag, creating the row or incrementing an existing
// one. Non-stackable tags are pinned at 1 no matter what is asked for, so a
// caller that forgot to check `tag.stackable` can't mint a phantom stack.
// `options.stackable` is the catalog flag and nothing else — no caller, GM
// surface included, may pass true for a tag the catalog says doesn't stack.
//
// `options.poisonedCount`/`options.poisonPayload` (the medical pass, M4):
// how many of the incoming units are tainted, and with what (the poison
// tag's id) — how Transfer and Loot carry a poisoned stack's state across
// the same primitive an ordinary hand-over uses. "Poisons don't mix": a
// batch merging into a row that already carries a DIFFERENT payload arrives
// CLEAN — the concentration is silently diluted rather than refused, since a
// refusal here would tell the recipient their food was tainted. A caller
// that never passes these two (every ordinary grant) is unaffected — the
// defaults are the no-poison case.
async function addToStack(tx, characterId, tagId, quantity, options = {}) {
  const {
    source = "GM_GRANT",
    expiresTurn = null,
    stackable = false,
    poisonedCount = 0,
    poisonPayload = null,
  } = options;
  const n = stackable ? Math.max(1, Math.trunc(quantity ?? 1)) : 1;
  const incomingPoisoned = poisonedCount > 0 ? Math.min(Math.trunc(poisonedCount), n) : 0;
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId } },
  });
  if (!existing) {
    const created = await tx.characterTag.create({
      data: {
        characterId,
        tagId,
        source,
        expiresTurn,
        quantity: n,
        poisonedCount: incomingPoisoned,
        poisonPayload: incomingPoisoned > 0 ? poisonPayload : null,
      },
    });
    await chargeWoundMood(tx, characterId, [tagId]);
    return created;
  }
  // Latent (M4 fix round): an already-held NON-stackable tag is left
  // entirely alone, poison options included — matching grantTagSlugs' own
  // rule that an existing non-stackable row's expiry/state is never
  // clobbered by a second grant. No caller passes poisonedCount for a
  // non-stackable tag today (poison rides on food/drink stacks, which are
  // always stackable), so this is a dropped-on-the-floor case that has never
  // actually fired rather than an observed bug.
  if (!stackable) return existing;
  const samePoison =
    !existing.poisonPayload || !poisonPayload || existing.poisonPayload === poisonPayload;
  return tx.characterTag.update({
    where: { id: existing.id },
    data: {
      quantity: existing.quantity + n,
      poisonedCount: samePoison ? existing.poisonedCount + incomingPoisoned : existing.poisonedCount,
      poisonPayload: existing.poisonPayload ?? (samePoison ? poisonPayload : null),
    },
  });
}

// Removes `quantity` of a tag, deleting the row once nothing is left. Pass
// null (the default) to drop the whole holding however large the stack —
// that is what an ordinary, non-stackable tag always wants.
//
// Returns `{ poisonedTaken, poisonPayload }` (M4): how many of the units
// that just left were drawn poisoned, and with what — a hypergeometric draw
// against the row AS IT STOOD before this call, so the odds are exactly
// `poisonedCount / quantity` per unit. Every caller that doesn't care (most
// of them — dropping a climbed drinking rung, a cured tag, a spent
// ingredient) simply ignores the return value, same as before this returned
// anything at all.
// A unit taken off a stack is never one that is equipped — equippedQuantity
// is clamped down to whatever quantity remains, freeing the slot(s) that
// frees, rather than leaving it pointing past the end of a shorter stack.
// This is the single place quantity ever shrinks without an explicit equip
// op, so it is the one place that has to know the invariant
// (equippedQuantity <= quantity) can break and put it back.
async function dropCharacterTag(tx, characterId, tagId, quantity = null) {
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId } },
  });
  if (!existing) return { poisonedTaken: 0, poisonPayload: null };
  const take = quantity == null ? existing.quantity : Math.max(1, Math.trunc(quantity));
  const poisonedTaken = existing.poisonedCount
    ? drawPoisonedUnits(existing.quantity, existing.poisonedCount, take)
    : 0;
  const poisonPayload = poisonedTaken > 0 ? existing.poisonPayload : null;
  if (take >= existing.quantity) {
    await tx.characterTag.delete({ where: { id: existing.id } });
    return { poisonedTaken, poisonPayload };
  }
  // Payload-clear invariant (fix round, M4): once the units actually LEAVING
  // take the poisonedCount to zero, the row must not keep pointing at a
  // payload that no longer taints anything — a stale poisonPayload with
  // poisonedCount 0 is a permanent false "already tainted" lock on a clean
  // stack (poisonItemRequestImpl's refusal reads exactly this pair).
  const remainingPoisoned = existing.poisonedCount - poisonedTaken;
  const remaining = existing.quantity - take;
  const equippedQuantity = Math.min(existing.equippedQuantity, remaining);
  await tx.characterTag.update({
    where: { id: existing.id },
    data: {
      quantity: remaining,
      equippedQuantity,
      equipped: equippedQuantity > 0,
      poisonedCount: remainingPoisoned,
      poisonPayload: remainingPoisoned > 0 ? existing.poisonPayload : null,
    },
  });
  return { poisonedTaken, poisonPayload };
}

// A stack shrunk by a raw quantity decrement OUTSIDE dropCharacterTag —
// riteEffects.js#spendFromHolder, thanatiActions.js#spendCharacterTag,
// requestActions.js#consumeRecipeItems, cavingPass.js's musk-lure spend —
// each a guarded conditional updateMany rather than dropCharacterTag, for its
// own concurrency reason documented at its call site (dropCharacterTag reads
// then writes, "the wrong shape for money"). Every one of those needs this
// run right after, the same clamp dropCharacterTag applies inline: a stack
// spent down to fewer units than are equipped frees the slots that frees,
// rather than leaving equippedQuantity pointing past the end of it.
//
// A single atomic UPDATE, safe to call unconditionally after any decrement —
// the WHERE only ever matches a row the decrement actually left
// over-equipped, so it is a no-op the rest of the time. Keyed on
// (characterId, tagId) rather than the row id because not every call site has
// read the row first.
async function clampEquippedQuantity(tx, characterId, tagId) {
  await tx.$executeRaw`
    UPDATE "CharacterTag"
    SET "equippedQuantity" = LEAST("equippedQuantity", "quantity"),
        "equipped" = (LEAST("equippedQuantity", "quantity") > 0)
    WHERE "characterId" = ${characterId} AND "tagId" = ${tagId}
      AND "equippedQuantity" > "quantity"
  `;
}

// A chain replaces upward (TAGS.md §3): gaining Melee (Trained) takes Melee
// (Basic) off the sheet. Drops every held ancestor of `tagId` — the tiers
// below it in its own parentTagId chain — and returns snapshots of what came
// off so a caller can record them for Undo. Reads the catalog itself, so a
// caller with no chain map (the lesson pass, Craft) needs nothing loaded.
async function replaceLowerTiers(tx, characterId, tagId) {
  const catalog = await tx.tag.findMany({ select: { id: true, name: true, parentTagId: true } });
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const below = new Set();
  let cursor = byId.get(tagId)?.parentTagId ?? null;
  while (cursor && !below.has(cursor)) {
    below.add(cursor);
    cursor = byId.get(cursor)?.parentTagId ?? null;
  }
  if (below.size === 0) return [];
  const held = await tx.characterTag.findMany({
    where: { characterId, tagId: { in: [...below] } },
  });
  const replaced = [];
  for (const ct of held) {
    replaced.push({
      tagId: ct.tagId,
      tagName: byId.get(ct.tagId)?.name ?? null,
      source: ct.source,
      expiresTurn: ct.expiresTurn,
      quantity: ct.quantity,
    });
    await tx.characterTag.delete({ where: { id: ct.id } });
  }
  return replaced;
}

// Grants a list of tag SLUGS to one character — what a consumed tag turns
// into (Tag.consumesInto: a meal becoming Ate Meal, a crate unpacking into
// its contents), and what a removed one leaves behind (Tag.removesInto: the
// treated-wound aftermath). Slugs rather than ids because that is what the
// catalog carries, specifically so a slug may REPEAT: listing one twice is
// the only way to ask for two of something.
//
// Returns the snapshot Undo needs — one entry per distinct slug, with
// `added` being what was ACTUALLY put on the sheet. That is 0 for a
// non-stackable tag the character already held, which is left entirely alone
// (expiry included: their existing one is the live truth, and clobbering it
// would silently extend or cut short something they already had). Undo may
// only take back what this request really added.
async function grantTagSlugs(tx, characterId, slugs, turnNumber, durations = null) {
  if (!slugs?.length) return [];

  const owed = new Map();
  for (const slug of slugs) owed.set(slug, (owed.get(slug) ?? 0) + 1);

  // The chrism's ward: a `blessed` character's soul cannot be claimed while
  // the anointing holds (docs/tags.yaml `blessed`; the chrism recipe). The
  // block is absolute on purpose — a GM who really means it strips Blessed
  // first — and the skipped grant reports itself in the snapshot
  // (`warded: true, added: 0`) instead of silently vanishing.
  const SOUL_CLAIM_SLUGS = ["broken", "broken-enslaved"];
  let blessedHeld = null;
  const isWarded = async (slug) => {
    if (!SOUL_CLAIM_SLUGS.includes(slug)) return false;
    if (blessedHeld == null) {
      blessedHeld =
        (await tx.characterTag.count({
          where: { characterId, tag: { slug: "blessed" } },
        })) > 0;
    }
    return blessedHeld;
  };

  const tags = await tx.tag.findMany({
    where: { slug: { in: [...owed.keys()] } },
    select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true },
  });
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]));

  const granted = [];
  for (const [slug, count] of owed) {
    if (await isWarded(slug)) {
      const tag = tagBySlug.get(slug);
      granted.push({ tagId: tag?.id ?? null, tagName: tag?.name ?? slug, slug, added: 0, warded: true });
      continue;
    }
    // Unknown slugs are rejected at sync time (db/lib/syncTags.js), so this
    // can only be a row predating a catalog edit — skip it rather than fail
    // the whole request.
    const tag = tagBySlug.get(slug);
    if (!tag) continue;

    const existing = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId: tag.id } },
    });

    if (!existing) {
      // A granted tag with its own duration starts its clock now, which is
      // what makes a chain work (meal -> Ate Meal that the sweep clears).
      // expiryFrom counts `turnNumber` itself as the tag's first live turn,
      // so a 1-turn grant runs out when this turn closes.
      //
      // A per-grant override (Tag.consumesIntoDurations, resolved by
      // web/lib/consumeGrants.js) wins over the tag's own duration, so one
      // status can outlast itself depending on what produced it — Bliss
      // leaves you High a turn longer than the raw fungus does.
      const durationTurns = durations?.[slug] ?? tag.defaultDurationTurns;
      // Backstop, not a front gate. Every caller is supposed to have resolved a
      // turn already (db/lib/grantExpiry.js#expiryForGrant defers to the next
      // one when an advance is in flight). Getting here with a timed tag and no
      // turn number means a caller skipped that, and the row would land with a
      // null expiresTurn — which never matches the sweep's `lte`, i.e. the tag
      // would be permanent and silent. Loud is better than that.
      if (durationTurns && turnNumber == null) {
        throw new Error(
          `grantTagSlugs: no turn number for timed tag "${slug}" (${durationTurns} turns) — ` +
            "the caller must resolve one via expiryForGrant, or it lands permanent.",
        );
      }
      const expiresTurn = expiryFrom(turnNumber, durationTurns);
      await tx.characterTag.create({
        data: {
          characterId,
          tagId: tag.id,
          source: "EVENT",
          quantity: tag.stackable ? count : 1,
          expiresTurn,
        },
      });
      await chargeWoundMood(tx, characterId, [tag.id]);
      granted.push({ tagId: tag.id, tagName: tag.name, added: tag.stackable ? count : 1 });
      continue;
    }

    if (tag.stackable) {
      await tx.characterTag.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + count },
      });
      granted.push({ tagId: tag.id, tagName: tag.name, added: count });
      continue;
    }

    granted.push({ tagId: tag.id, tagName: tag.name, added: 0 });
  }

  return granted;
}

// --- Room stashes (docs/systemdocs/CARRY.md) ---------------------------
//
// A Room's stash is the game's first MULTI-ACTOR inventory: two players
// standing in the same public room can pull the same stack in the same tick.
// dropCharacterTag can afford a read-then-write because a character has one
// actor; here the decrement IS the check — the conditional-updateMany lesson
// from resourceTransfer.js#moveParty.

// The room-stash serializer (fix round M4b, fix 2), same idiom as
// requestActions.js#lockCharacter: a raw row lock Postgres holds to the end
// of the caller's transaction, so two writers queue up instead of both
// reading the same RoomTag snapshot. Locks the ROOM row rather than the
// RoomTag row — a Room always exists (the stash line may not, especially on
// the create path addToRoomStack's `!existing` branch covers), and every
// caller into this file already has a roomId in hand with nothing more to
// look up first.
//
// Lock order: every caller that locks BOTH a Character row and a Room row in
// the same transaction must take the character lock(s) first — this module
// never takes a character lock itself, so the ordering is enforced entirely
// by call-site discipline. Audited at the fix's writing: no caller of
// dropRoomTag/addToRoomStack locks a Character row afterward in the same
// transaction, so there is no established call site to invert.
function lockRoom(tx, roomId) {
  return tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
}

// Adds `quantity` of a tag to a room, creating the row or incrementing it.
// Deliberately NO non-stackable pin: two players can each leave their
// Longbow here and the row must go to 2. The pin is a rule about what one
// CHARACTER can hold, and addToStack re-applies it on the way out.
// `expiresTurn` carries over from the holder's row; an earlier clock wins
// when stacks with different clocks merge, so stashing never extends one.
//
// `poisonedCount`/`poisonPayload` (M4) — same contract as addToStack's:
// merging into a row that already carries a DIFFERENT payload dilutes the
// incoming units clean rather than refusing.
async function addToRoomStack(
  tx,
  roomId,
  tagId,
  quantity,
  { expiresTurn = null, poisonedCount = 0, poisonPayload = null } = {},
) {
  const n = Math.max(1, Math.trunc(quantity ?? 1));
  const incomingPoisoned = poisonedCount > 0 ? Math.min(Math.trunc(poisonedCount), n) : 0;
  // Room lock (fix round M4b, fix 2): taken BEFORE the read below, so two
  // first-poison stashes landing on the same clean row can no longer both
  // see `existing.poisonPayload === null` and both increment — the second
  // writer now queues behind the first and re-reads the row it actually
  // left behind. Covers the create path too (a Room row always exists to
  // lock, even when this RoomTag line doesn't yet).
  await lockRoom(tx, roomId);
  const existing = await tx.roomTag.findUnique({ where: { roomId_tagId: { roomId, tagId } } });
  if (!existing) {
    return tx.roomTag.create({
      data: {
        roomId,
        tagId,
        quantity: n,
        expiresTurn,
        poisonedCount: incomingPoisoned,
        poisonPayload: incomingPoisoned > 0 ? poisonPayload : null,
      },
    });
  }
  const clocks = [existing.expiresTurn, expiresTurn].filter((t) => t != null);
  const samePoison =
    !existing.poisonPayload || !poisonPayload || existing.poisonPayload === poisonPayload;
  return tx.roomTag.update({
    where: { id: existing.id },
    data: {
      quantity: { increment: n },
      expiresTurn: clocks.length ? Math.min(...clocks) : null,
      // The room-merge race (fix round, M4): two stashes landing on this row
      // in the same instant both read `existing.poisonedCount` from the SAME
      // snapshot above, same trap the quantity column solves with
      // `{ increment }`. So the poison columns are only ever written when
      // this merge actually ADDS poison (atomically) — a clean merge or a
      // different-payload dose ("lost in the mix") leaves both columns
      // entirely out of the update, so a concurrent taker's decrement or
      // payload-clear is never overwritten with this snapshot's stale copy.
      ...(incomingPoisoned > 0 && samePoison
        ? {
            poisonedCount: { increment: incomingPoisoned },
            poisonPayload: poisonPayload ?? existing.poisonPayload,
          }
        : {}),
    },
  });
}

// Removes `quantity` of a tag from a room (null = the whole stack). Returns
// `{ ok, poisonedTaken, poisonPayload }` — `ok` false when the stack no
// longer covers it (a concurrent taker got there first), so the caller can
// refuse cleanly instead of overdrawing. `poisonedTaken`/`poisonPayload` (M4)
// mirror dropCharacterTag's: a hypergeometric draw against the row as it
// stood before the decrement, ignored by every caller that doesn't move
// poison state onward.
async function dropRoomTag(tx, roomId, tagId, quantity = null) {
  // Room lock (fix round M4b, fix 2): taken before either read below. Two
  // concurrent 1-unit withdrawals off a quantity=2/poisoned=1 row used to
  // both draw against the SAME unlocked snapshot — both could draw clean
  // and delete the row out from under the poisoned unit, or a valid
  // withdrawal could be refused by a stale read. Serializing on the Room
  // row means the second caller now re-reads whatever the first actually
  // left behind.
  await lockRoom(tx, roomId);
  if (quantity == null) {
    const existing = await tx.roomTag.findUnique({ where: { roomId_tagId: { roomId, tagId } } });
    await tx.roomTag.deleteMany({ where: { roomId, tagId } });
    return { ok: true, poisonedTaken: existing?.poisonedCount ?? 0, poisonPayload: existing?.poisonPayload ?? null };
  }
  const n = Math.max(1, Math.trunc(quantity));
  const existing = await tx.roomTag.findUnique({ where: { roomId_tagId: { roomId, tagId } } });
  if (!existing || existing.quantity < n) return { ok: false, poisonedTaken: 0, poisonPayload: null };
  const poisonedTaken = existing.poisonedCount
    ? drawPoisonedUnits(existing.quantity, existing.poisonedCount, n)
    : 0;
  const poisonPayload = poisonedTaken > 0 ? existing.poisonPayload : null;
  // Negative-count guard (fix round, M4): `poisonedCount` is read from the
  // SAME pre-lock snapshot as `quantity` above, but only `quantity` has its
  // own where-guard keeping the decrement conditional on committed state — a
  // concurrent drop between the read and this write could already have taken
  // some of the poisoned units, and an unconditional `decrement` would drive
  // the column negative. Guarding it the same way `quantity` already is
  // restores "the decrement IS the check" for both columns, not just one: a
  // stale poisonedTaken now fails the whole write (count stays 0) rather than
  // partially applying.
  const { count } = await tx.roomTag.updateMany({
    where: { roomId, tagId, quantity: { gte: n }, poisonedCount: { gte: poisonedTaken } },
    data: { quantity: { decrement: n }, poisonedCount: { decrement: poisonedTaken } },
  });
  if (count === 0) return { ok: false, poisonedTaken: 0, poisonPayload: null };
  // Payload-clear invariant (fix round, M4): the decrement above can take
  // poisonedCount to exactly 0 in the same statement that shrinks quantity,
  // so there is no single atomic write that clears poisonPayload only when
  // the RESULT lands on zero — a second, itself-guarded update covers it.
  // Idempotent and cheap: it only touches a row that both needs it and still
  // exists (the delete below may remove it first on some other path, but
  // never before this one runs).
  await tx.roomTag.updateMany({
    where: { roomId, tagId, poisonedCount: { lte: 0 }, poisonPayload: { not: null } },
    data: { poisonPayload: null },
  });
  await tx.roomTag.deleteMany({ where: { roomId, tagId, quantity: { lte: 0 } } });
  return { ok: true, poisonedTaken, poisonPayload };
}

module.exports = {
  addToStack,
  dropCharacterTag,
  clampEquippedQuantity,
  replaceLowerTiers,
  grantTagSlugs,
  addToRoomStack,
  dropRoomTag,
  lockRoom,
};
