// Tag writes shared by both faces — the bot's GM `/heal` command and every web/lib/tagEffects.js caller go through these, so a write is never implemented twice.
// Every function takes a transaction client (`tx`) first rather than the singleton, so a caller can compose it into a larger transaction (the db/lib/dm.js convention).
const { expiryFrom } = require("./turnFormat");
const { drawPoisonedUnits } = require("./poison");
const { pricedTag } = require("./pricedTags");
const { record, characterParty, roomParty, MINT, BURN } = require("./economyLedger");

// The economy side of a tag write — decides whether a write is money moving in a coat (docs/systemdocs/DEPOT.md §0g) or just a tag, at zero extra cost to the ~135 hot-path callers since `pricedTag` answers from an in-memory cache.
// `signedQuantity` positive is an add, negative a drop (flips `from`/`to` the way economyLedger#record does). `options.econ` overrides `from`/`to`/`reason`. Never throws: a bookkeeping miss must not cost a player their item.
async function recordTagMoney(tx, holder, tagId, signedQuantity, econ = {}) {
  if (!holder || !signedQuantity) return;
  try {
    const priced = await pricedTag(tx, tagId);
    if (!priced) return; // no price on this tag: not money, nothing to record
    econ = econ ?? {};
    let form = "COIN";
    let unitValue = 1;
    if (!priced.isObol) {
      unitValue = priced.sellablePrice ?? priced.depotPrice ?? null;
      if (!unitValue) return; // no price on this tag: not money, nothing to record
      form = "GOODS";
    }
    const amount = signedQuantity * unitValue;
    const defaultFrom = signedQuantity > 0 ? MINT : holder;
    const defaultTo = signedQuantity > 0 ? holder : BURN;
    await record(
      tx,
      {
        from: econ.from ?? defaultFrom,
        to: econ.to ?? defaultTo,
        form,
        amount: Math.abs(amount),
        tag: { id: tagId, slug: priced.slug },
        quantity: Math.abs(signedQuantity),
        unitValue,
      },
      econ,
    );
  } catch (err) {
    console.error("[tagWrites] economy record failed:", err?.message ?? err);
  }
}

// The money half of the same bargain clampEquippedQuantity strikes: the raw guarded-decrement call sites skip dropCharacterTag's ledger hook, so a priced ware leaving that way drifted the holder permanently. Call this right where you already call clampEquippedQuantity, with the quantity that actually left.
async function recordSpentTagMoney(tx, holder, tagId, quantity, econ = {}) {
  await recordTagMoney(tx, holder, tagId, -Math.abs(quantity || 0), econ);
}
const { INSPIRED_SLUG } = require("./constants");

// A wound landing on a sheet frightens its owner (docs/systemdocs/MOOD.md). Only the `!existing` branches call this — a stack going up isn't a new wound. Required lazily to avoid a cycle with db/lib/mood.js. Wrapped: a mood hiccup must never fail a tag write.
async function chargeWoundMood(tx, characterId, tagIds) {
  try {
    await require("./mood").applyWoundMood(tx, characterId, tagIds);
  } catch (err) {
    console.error(`Wound mood failed for ${characterId}:`, err.message ?? err);
  }
}

// Adds `quantity` of a tag, creating or incrementing. Non-stackable tags are pinned at 1, so a caller that forgot to check `tag.stackable` can't mint a phantom stack; `options.stackable` must match the catalog flag.
// `options.poisonedCount`/`poisonPayload`: how Transfer/Loot carry a poisoned stack's state. "Poisons don't mix" — merging into a row with a DIFFERENT payload arrives CLEAN (diluted, not refused, since a refusal would tell the recipient their food was tainted).
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
    // Record what was ACTUALLY written (`n`), never the raw `quantity` argument.
    await recordTagMoney(tx, characterParty({ id: characterId }), tagId, n, options.econ);
    return created;
  }
  // An already-held NON-stackable tag is left entirely alone, poison options included — matches grantTagSlugs' rule that an existing non-stackable row's state is never clobbered by a second grant. Nothing written, nothing recorded.
  if (!stackable) return existing;
  const samePoison =
    !existing.poisonPayload || !poisonPayload || existing.poisonPayload === poisonPayload;
  const updated = await tx.characterTag.update({
    where: { id: existing.id },
    data: {
      quantity: existing.quantity + n,
      poisonedCount: samePoison ? existing.poisonedCount + incomingPoisoned : existing.poisonedCount,
      poisonPayload: existing.poisonPayload ?? (samePoison ? poisonPayload : null),
    },
  });
  await recordTagMoney(tx, characterParty({ id: characterId }), tagId, n, options.econ);
  return updated;
}

// Removes `quantity` of a tag, deleting the row once empty. Pass null (default) to drop the whole holding. Returns `{ poisonedTaken, poisonPayload }`: a hypergeometric draw against the row as it stood before this call (`poisonedCount / quantity` odds per unit); most callers ignore it.
// equippedQuantity is clamped down to whatever quantity remains — the single place quantity ever shrinks without an explicit equip op, so it's the one place that must restore the (equippedQuantity <= quantity) invariant.
async function dropCharacterTag(tx, characterId, tagId, quantity = null, options = {}) {
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
    // `take` may exceed what was held — `existing.quantity`, not the request, is what actually left.
    await recordTagMoney(tx, characterParty({ id: characterId }), tagId, -existing.quantity, options.econ);
    return { poisonedTaken, poisonPayload };
  }
  // Payload-clear invariant: once units leaving take poisonedCount to zero, the row must not keep a stale poisonPayload — that pair would lock a clean stack as "already tainted" (poisonItemRequestImpl's refusal reads it).
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
  await recordTagMoney(tx, characterParty({ id: characterId }), tagId, -take, options.econ);
  return { poisonedTaken, poisonPayload };
}

// db/lib/advantage.js#rollWithAdvantage reports which tag granted advantage (`source`); Inspired must disappear the moment it wins, Lucky is permanent and never touched here. Called right after rolling, in the same transaction. No-op for Lucky or nothing.
async function consumeInspiredIfUsed(tx, characterId, source) {
  if (source !== "inspired") return;
  const held = await tx.characterTag.findFirst({
    where: { characterId, tag: { slug: INSPIRED_SLUG } },
    select: { tagId: true },
  });
  if (held) await dropCharacterTag(tx, characterId, held.tagId);
}

// A stack shrunk by a raw quantity decrement OUTSIDE dropCharacterTag — riteEffects.js#spendFromHolder, thanatiActions.js#spendCharacterTag, cavingPass.js's musk-lure spend — each a guarded conditional updateMany for its own concurrency reason (dropCharacterTag reads then writes, "the wrong shape for money"). Each needs this run right after, the same clamp dropCharacterTag applies inline.
// A single atomic UPDATE, safe to call unconditionally after any decrement — the WHERE only matches a row left over-equipped. Keyed on (characterId, tagId) since not every call site has read the row first.
async function clampEquippedQuantity(tx, characterId, tagId) {
  await tx.$executeRaw`
    UPDATE "CharacterTag"
    SET "equippedQuantity" = LEAST("equippedQuantity", "quantity"),
        "equipped" = (LEAST("equippedQuantity", "quantity") > 0)
    WHERE "characterId" = ${characterId} AND "tagId" = ${tagId}
      AND "equippedQuantity" > "quantity"
  `;
}

// A chain replaces upward (TAGS.md §3): gaining Melee (Trained) takes Melee (Basic) off the sheet. Drops every held ancestor of `tagId` and returns snapshots for Undo. Reads the catalog itself, so a caller with no chain map needs nothing loaded.
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

// Grants a list of tag SLUGS — what a consumed tag turns into (Tag.consumesInto) or a removed one leaves behind (Tag.removesInto). Slugs, not ids, so one may REPEAT (the only way to ask for two of something).
// Returns the snapshot Undo needs: `added` is what was ACTUALLY put on the sheet — 0 for an already-held non-stackable tag, left entirely alone (its existing expiry is the live truth). Undo may only take back what this request really added.
async function grantTagSlugs(tx, characterId, slugs, turnNumber, durations = null) {
  if (!slugs?.length) return [];

  const owed = new Map();
  for (const slug of slugs) owed.set(slug, (owed.get(slug) ?? 0) + 1);

  // The chrism's ward: a `blessed` character's soul cannot be claimed while the anointing holds (docs/tags.yaml `blessed`). Absolute on purpose — a GM who means it strips Blessed first — and the skipped grant reports itself (`warded: true, added: 0`) instead of silently vanishing.
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
    // Unknown slugs are rejected at sync time (db/lib/syncTags.js); skip rather than fail the whole request.
    const tag = tagBySlug.get(slug);
    if (!tag) continue;

    const existing = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId: tag.id } },
    });

    if (!existing) {
      // A granted tag's own duration starts its clock now (what makes a chain work: meal -> Ate Meal). expiryFrom counts `turnNumber` as the first live turn, so a 1-turn grant runs out when this turn closes.
      // A per-grant override (Tag.consumesIntoDurations, web/lib/consumeGrants.js) wins over the tag's own duration — Bliss leaves you High a turn longer than raw fungus does.
      const durationTurns = durations?.[slug] ?? tag.defaultDurationTurns;
      // Backstop, not a front gate: every caller must have resolved a turn (db/lib/grantExpiry.js#expiryForGrant). Skipping that would land a null expiresTurn that never matches the sweep's `lte` — a permanent, silent tag. Loud is better.
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
// A Room's stash is the game's first MULTI-ACTOR inventory: two players can pull the same stack in the same tick. dropCharacterTag can afford read-then-write (one actor); here the decrement IS the check (the conditional-updateMany lesson from resourceTransfer.js#moveParty).

// The room-stash serializer, same idiom as requestActions.js#lockCharacter: a raw row lock held to the end of the transaction, so writers queue instead of reading the same RoomTag snapshot. Locks the ROOM row (always exists, unlike a stash line) rather than RoomTag.
// Lock order: any caller locking both a Character and a Room row must take the character lock first — enforced entirely by call-site discipline, since this module never takes a character lock itself.
function lockRoom(tx, roomId) {
  return tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
}

// Adds `quantity` of a tag to a room. Deliberately NO non-stackable pin: two players can each leave a Longbow and the row must go to 2 (the pin is a rule about one CHARACTER's hold; addToStack re-applies it on the way out). Earlier clock wins on merge, so stashing never extends one.
// `poisonedCount`/`poisonPayload`: same contract as addToStack's — a DIFFERENT payload dilutes clean rather than refusing.
async function addToRoomStack(
  tx,
  roomId,
  tagId,
  quantity,
  { expiresTurn = null, poisonedCount = 0, poisonPayload = null, econ = undefined } = {},
) {
  const n = Math.max(1, Math.trunc(quantity ?? 1));
  const incomingPoisoned = poisonedCount > 0 ? Math.min(Math.trunc(poisonedCount), n) : 0;
  // Room lock taken BEFORE the read below, so two first-poison stashes on the same clean row can't both see `poisonPayload === null` and both increment — the second queues and re-reads. Covers the create path (a Room row always exists to lock).
  await lockRoom(tx, roomId);
  const existing = await tx.roomTag.findUnique({ where: { roomId_tagId: { roomId, tagId } } });
  if (!existing) {
    const created = await tx.roomTag.create({
      data: {
        roomId,
        tagId,
        quantity: n,
        expiresTurn,
        poisonedCount: incomingPoisoned,
        poisonPayload: incomingPoisoned > 0 ? poisonPayload : null,
      },
    });
    await recordTagMoney(tx, roomParty({ id: roomId }), tagId, n, econ);
    return created;
  }
  const clocks = [existing.expiresTurn, expiresTurn].filter((t) => t != null);
  const samePoison =
    !existing.poisonPayload || !poisonPayload || existing.poisonPayload === poisonPayload;
  const updated = await tx.roomTag.update({
    where: { id: existing.id },
    data: {
      quantity: { increment: n },
      expiresTurn: clocks.length ? Math.min(...clocks) : null,
      // Same trap `{ increment }` solves for quantity: the poison columns are only written when this merge actually ADDS poison, so a concurrent taker's decrement or payload-clear is never overwritten by a stale snapshot.
      ...(incomingPoisoned > 0 && samePoison
        ? {
            poisonedCount: { increment: incomingPoisoned },
            poisonPayload: poisonPayload ?? existing.poisonPayload,
          }
        : {}),
    },
  });
  await recordTagMoney(tx, roomParty({ id: roomId }), tagId, n, econ);
  return updated;
}

// Removes `quantity` of a tag from a room (null = whole stack). Returns `{ ok, poisonedTaken, poisonPayload }` — `ok` false when a concurrent taker got there first, so the caller refuses cleanly. Poison fields mirror dropCharacterTag's.
async function dropRoomTag(tx, roomId, tagId, quantity = null, options = {}) {
  // Room lock taken before either read below: two concurrent withdrawals off the same row could both draw against a stale snapshot, deleting it out from under a poisoned unit. Serializing means the second caller re-reads what the first left.
  await lockRoom(tx, roomId);
  if (quantity == null) {
    const existing = await tx.roomTag.findUnique({ where: { roomId_tagId: { roomId, tagId } } });
    await tx.roomTag.deleteMany({ where: { roomId, tagId } });
    // `quantity = null` drops the WHOLE holding — record `existing.quantity`, the actual amount, not a request naming no number.
    if (existing?.quantity) {
      await recordTagMoney(tx, roomParty({ id: roomId }), tagId, -existing.quantity, options.econ);
    }
    return { ok: true, poisonedTaken: existing?.poisonedCount ?? 0, poisonPayload: existing?.poisonPayload ?? null };
  }
  const n = Math.max(1, Math.trunc(quantity));
  const existing = await tx.roomTag.findUnique({ where: { roomId_tagId: { roomId, tagId } } });
  if (!existing || existing.quantity < n) return { ok: false, poisonedTaken: 0, poisonPayload: null };
  const poisonedTaken = existing.poisonedCount
    ? drawPoisonedUnits(existing.quantity, existing.poisonedCount, n)
    : 0;
  const poisonPayload = poisonedTaken > 0 ? existing.poisonPayload : null;
  // Negative-count guard: `poisonedCount` is read from the same pre-lock snapshot as `quantity`, but only `quantity` has a where-guard — a concurrent drop could already have taken poisoned units, driving an unconditional decrement negative. Guarding both restores "the decrement IS the check": a stale poisonedTaken now fails the whole write instead of partially applying.
  const { count } = await tx.roomTag.updateMany({
    where: { roomId, tagId, quantity: { gte: n }, poisonedCount: { gte: poisonedTaken } },
    data: { quantity: { decrement: n }, poisonedCount: { decrement: poisonedTaken } },
  });
  if (count === 0) return { ok: false, poisonedTaken: 0, poisonPayload: null };
  // Payload-clear invariant: the decrement can take poisonedCount to 0 in the same statement that shrinks quantity, so no single atomic write clears poisonPayload only then — a second, itself-guarded update covers it. Idempotent and cheap.
  await tx.roomTag.updateMany({
    where: { roomId, tagId, poisonedCount: { lte: 0 }, poisonPayload: { not: null } },
    data: { poisonPayload: null },
  });
  await tx.roomTag.deleteMany({ where: { roomId, tagId, quantity: { lte: 0 } } });
  await recordTagMoney(tx, roomParty({ id: roomId }), tagId, -n, options.econ);
  return { ok: true, poisonedTaken, poisonPayload };
}

module.exports = {
  recordSpentTagMoney,
  addToStack,
  dropCharacterTag,
  consumeInspiredIfUsed,
  clampEquippedQuantity,
  replaceLowerTiers,
  grantTagSlugs,
  addToRoomStack,
  dropRoomTag,
  lockRoom,
};
