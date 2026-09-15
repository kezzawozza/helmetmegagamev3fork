// Carry caps, the Overburdened status and the overflow drop (CARRY.md).
// A character carries two loads against two caps: POUNDS of gear against
// GameConfig.carryWeightLbs, and ⬢ against carryResourceCap. Both are moved by the SUM of every carryBonus they hold. Over a cap is allowed and grants `overburdened`; over 1.5× it is not allowed at all, and whatever pushed them there is set down where they stand.
// NOT client-importable, despite the pure-looking maths at the top: the requires below reach Prisma (./tagWrites) and Discord (./dm, ./roomAnnounce), so any path into this file drags the barrel into the browser bundle (ARCHITECTURE.md §2). A client component wanting a weight reads db/lib/tagWeight.js, which is zero-require for exactly this reason. settleCarry below is the stateful half: pull-based and post-commit, same posture as roomAccess.js#syncCharacterRoomAccess, since the writers that change what a character holds are many and scattered (ten bypass tagWrites.js with raw deleteMany) and a push from any one would miss the rest.
// Takes `prisma` as a parameter and stays OFF the @lifeweb/db barrel — db/index.js's turn engine imports this, so requiring the barrel back would resolve to a partial exports object. Require it by path.
const { OVERBURDENED_SLUG } = require("./constants");
const { addToStack, dropCharacterTag, addToRoomStack } = require("./tagWrites");
const { moveParty } = require("./resourceTransfer");
const { pickRandomPublicRoom, formatManifest } = require("./roomStash");
const { announceInRoom } = require("./roomAnnounce");
const { sendDm } = require("./dm");
const { rowWeight, round2 } = require("./tagWeight");

// The combined bonus is carried ×1000 as an integer so the sum of several
// two-decimal bonuses stays exact, never a float epsilon.
const MULT_SCALE = 1000;

// The floor under the summed bonuses — penalties add up, and the catalog holds enough of them that a thoroughly broken body could reach zero or go negative; a 0 lb cap would leave a character permanently Overburdened with nothing they could put down to fix it.
const MIN_MILLI = 250;

// How far past a cap a character may go before the goods simply cannot be theirs. Between 1× and this they're Overburdened; past it, an acquisition is refused and an involuntary gain is set down on the spot.
const HARD_CAP_RATIO = 1.5;

// Does this row's carryBonus count right now? A vehicle has to be in your hands — an
// unequipped Cart is parked and hauls nothing. A body doesn't — Pack Mule, Frail and a broken rib aren't `equippable` at all. Testing `equippable` rather than listing slugs keeps the rule in the catalog where the rest of a tag's behaviour lives.
function multiplierApplies(ct) {
  const m = ct?.tag?.carryBonus;
  if (!(typeof m === "number" && Number.isFinite(m) && m !== 0)) return false;
  return ct.tag.equippable ? ct.equipped === true : true;
}

// SUM of every ACTIVE Tag.carryBonus, as a milli-multiplier (1000 = ×1). Per ROW, not
// per unit — nothing carrying a bonus is stackable. Additive, not multiplicative, now that bodies can carry a penalty: multiplied, Frail ×0.9 took 60 lb off a character pulling a cart and 12 lb off a peasant — same frailty, five times the bite, decided by unrelated gear. Added, a frail body costs everyone the same 12 lb.
function carryMultiplier(characterTags = []) {
  let sum = 0;
  for (const ct of characterTags) if (multiplierApplies(ct)) sum += ct.tag.carryBonus;
  return Math.max(MIN_MILLI, Math.round((1 + sum) * MULT_SCALE));
}

// One line per active bonus, for the hover breakdown on /character — the player should see exactly what's holding their cap up, or pushing it down.
function carryBreakdown(characterTags = []) {
  return characterTags.filter(multiplierApplies).map((ct) => ({
    slug: ct.tag.slug,
    name: ct.tag.name,
    bonus: ct.tag.carryBonus,
  }));
}

// What counts against the weight cap, in pounds. rowWeight is db/lib/tagWeight.js's, shared with the browser so a readout and the cap can never disagree.
function carryWeight(characterTags = []) {
  let lbs = 0;
  for (const ct of characterTags ?? []) lbs += rowWeight(ct);
  // Weights are authored to one decimal, so round the sum rather than let
  // float noise show a player "83.99999 lb".
  return round2(lbs);
}

function carryCaps(config, milli = MULT_SCALE) {
  const weightCap = config?.carryWeightLbs ?? 71;
  const resourceCap = config?.carryResourceCap ?? 25;
  return {
    weight: Math.floor((weightCap * milli) / MULT_SCALE),
    resources: Math.floor((resourceCap * milli) / MULT_SCALE),
  };
}

// The ceiling nothing may cross, derived rather than stored so a GM raising the base cap moves both lines together.
function carryHardCaps(caps) {
  return {
    weight: Math.floor(caps.weight * HARD_CAP_RATIO),
    resources: Math.floor(caps.resources * HARD_CAP_RATIO),
  };
}

// The readout a sheet shows. `character` needs { tags, resources }.
function carryStatus(character, config) {
  const milli = carryMultiplier(character?.tags);
  const caps = carryCaps(config, milli);
  const hard = carryHardCaps(caps);
  const weightUsed = carryWeight(character?.tags);
  const resources = character?.resources ?? 0;
  return {
    weightUsed,
    weightCap: caps.weight,
    weightHardCap: hard.weight,
    resources,
    resourcesCap: caps.resources,
    resourcesHardCap: hard.resources,
    multiplier: milli / MULT_SCALE,
    breakdown: carryBreakdown(character?.tags),
    baseWeightCap: config?.carryWeightLbs ?? 71,
    over: weightUsed > caps.weight || resources > caps.resources,
  };
}

// The one guard every DELIBERATE acquisition asks before it writes — Transfer, Craft,
// /store, the Depot, Loot, pulling out of a room stash. An involuntary gain (a Labor payout, Caving loot, a GM grant) does NOT ask — it lands, and settleCarry sets down whatever won't fit. Returns { ok } or { ok: false, reason }, so a caller can hand the sentence straight to the player.
function carryAdmits(character, config, { weightLbs = 0, resources = 0 } = {}) {
  const caps = carryCaps(config, carryMultiplier(character?.tags));
  const hard = carryHardCaps(caps);
  if (weightLbs > 0) {
    const after = carryWeight(character?.tags) + weightLbs;
    if (after > hard.weight) {
      return {
        ok: false,
        reason: `That would put you at ${Math.round(after)} lb, past the ${hard.weight} lb you could carry even overburdened. Put something down first.`,
      };
    }
  }
  if (resources > 0) {
    const after = (character?.resources ?? 0) + resources;
    if (after > hard.resources) {
      return {
        ok: false,
        reason: `That would put you at ${after} ⬢, past the ${hard.resources} ⬢ you could carry even overburdened. Put something down first.`,
      };
    }
  }
  return { ok: true };
}

// The sentence a carry tag's description ends with, computed from the live config —
// what THIS bonus does to the base caps on its own. Bascinet's wording; the ⬢ glyph replaces the word per CLAUDE.md's Resources rule. Two branches, since a bonus can now be negative and "You can carry -60 more lb" isn't a sentence anybody should read.
function carryBonusLine(config, bonus) {
  const base = carryCaps(config, MULT_SCALE);
  const moved = carryCaps(config, Math.round((1 + (bonus ?? 0)) * MULT_SCALE));
  const lbs = moved.weight - base.weight;
  const resources = moved.resources - base.resources;
  if (lbs < 0 || resources < 0) {
    return `You can carry ${Math.abs(lbs)} lb less, and ${Math.abs(resources)} ⬢ less.`;
  }
  return `You can carry ${lbs} more lb, and ${resources} ⬢.`;
}

// --- Settlement ----------------------------------------------------------

const CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  discordUserId: true,
  locationId: true,
  resources: true,
  carryWeightSeen: true,
  carryResourcesSeen: true,
  age: true,
  gender: true,
  tags: {
    select: {
      id: true,
      tagId: true,
      quantity: true,
      equipped: true,
      equippedQuantity: true,
      expiresTurn: true,
      // What drawDrops sorts an overflow shed by (below) — the row most
      // recently added to, never "whenever this row was first created".
      acquiredAt: true,
      tag: {
        select: {
          id: true,
          slug: true,
          name: true,
          category: true,
          tradeable: true,
          weightLbs: true,
          equippable: true,
          carryBonus: true,
        },
      },
    },
  },
};

let warnedMissingTag = false;

// Draws UNITS out of the droppable holdings, NEWEST-ACQUIRED first, until
// `excessLbs` pounds have been shed. Returns [{ tagId, tagName, quantity,
// expiresTurn }] aggregated per tag. Carry-bonus tags and equipped gear are
// never in the bag: dropping the Cart to fix being over would shrink the cap
// again and loop, and being disarmed by an overfull pack reads badly.
//
// Newest first, not a shuffle — changed 2026-09-13. A random draw could shed
// whatever a character was already carrying to make room for something
// someone had just handed them, which turned Transfer into a griefing tool:
// dump something heavy on a person and pick through whatever THEY drop. The
// thing that just arrived is what goes back on the ground first; only once
// that is not enough does an older holding get shed too. `Tag.stackable`'s
// fungibility means a top-up merges into the existing row rather than
// creating a second one (tagWrites.js#addToStack, tagEffects.js
// #restoreCharacterTag), so `acquiredAt` on a stack is "last topped up", not
// "first ever held" — which is exactly the reading this sort wants.
//
// "Equipped gear" means only the equipped UNITS, not the whole row — three
// swords equipped out of five leaves the other two exactly as droppable as
// anything else in the pack, since a slot only protects what is actually in
// it.
//
// A weightless unit can never help, so it is not even a candidate — otherwise
// this would spend draws on letters while the anvil stayed put.
function drawDrops(characterTags, excessLbs) {
  const units = [];
  for (const ct of characterTags) {
    if (!ct.tag.tradeable || ct.tag.carryBonus) continue;
    const each = rowWeight({ ...ct, quantity: 1 });
    if (each <= 0) continue;
    const droppable = Math.max(0, (ct.quantity ?? 1) - (ct.equippedQuantity ?? 0));
    for (let i = 0; i < droppable; i += 1) units.push(ct);
  }
  // Every push above shares the same `ct` for one row, so this only ever
  // orders ROWS against each other — units off the same stack stay together.
  units.sort((a, b) => (b.acquiredAt?.getTime?.() ?? 0) - (a.acquiredAt?.getTime?.() ?? 0));
  const chosen = [];
  let shed = 0;
  for (const ct of units) {
    if (shed >= excessLbs) break;
    chosen.push(ct);
    shed += rowWeight({ ...ct, quantity: 1 });
  }
  const taken = new Map();
  for (const ct of chosen) {
    const entry = taken.get(ct.tagId) ?? {
      tagId: ct.tagId,
      tagName: ct.tag.name,
      quantity: 0,
      expiresTurn: ct.expiresTurn,
    };
    entry.quantity += 1;
    taken.set(ct.tagId, entry);
  }
  return [...taken.values()];
}

// The holdings as they stand after a drop manifest is applied, so the load can be recomputed without a second read inside the transaction.
function applyDrops(characterTags, taken) {
  const byTag = new Map(taken.map((t) => [t.tagId, t.quantity]));
  return characterTags
    .map((ct) => {
      const gone = byTag.get(ct.tagId) ?? 0;
      if (!gone) return ct;
      return { ...ct, quantity: Math.max(0, (ct.quantity ?? 1) - gone) };
    })
    .filter((ct) => (ct.quantity ?? 1) > 0);
}

// Recomputes one character's load against their caps and makes the sheet agree with
// it: grants or clears `overburdened`, and — past the HARD cap (1.5×, carryAdmits above) — sets the excess down in a random public room at their Location.
// The drop is acquisition-driven, never capacity-driven — Character.carryWeightSeen /
// carryResourcesSeen are what tell the two apart: a load that hasn't GROWN since the last settle sheds nothing, however far the cap has fallen beneath it, so unequipping a cart at an inn door or a GM lowering the base cap makes people Overburdened and no more. Only goods that arrived without asking (a Labor payout, Caving loot, a GM grant) can push someone past the ceiling, and only those get set down — deliberate acquisitions are refused by carryAdmits() before they land.
// Returns null when there was nothing to do; otherwise { characterId, over, granted,
// removed, drop } where `drop` carries the Discord work for deliverCarryDrop(). Nothing here talks to Discord: web callers deliver in after(), the turn pass hands the drops to runSideEffects.
// With nowhere to put anything down (unplaced, or a Location with no public room) the
// character simply stays over the ceiling and the next settle (arrival, or turn close) retries for free. `{ drop: false }` settles the status without ever shedding, what the sync's rebase wants.
async function settleCarry(prisma, characterId, { drop = true } = {}) {
  if (!characterId) return null;
  return prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { id: characterId }, select: CHARACTER_SELECT });
    if (!character || character.status !== "ALIVE") return null;
    const config = await tx.gameConfig.findUnique({
      where: { id: 1 },
      select: { carryWeightLbs: true, carryResourceCap: true },
    });

    const caps = carryCaps(config, carryMultiplier(character.tags));
    const hard = carryHardCaps(caps);
    let load = carryWeight(character.tags);
    let resources = character.resources;
    let over = load > caps.weight || resources > caps.resources;

    // The watermark is the whole of what distinguishes an ACQUISITION from a capacity
    // SHRINK. A load that hasn't grown since the last settle sheds nothing, however far over the ceiling the cap has fallen — this is what lets a cart be parked at an inn door without emptying it.
    const seenWeight = character.carryWeightSeen ?? 0;
    const seenResources = character.carryResourcesSeen ?? 0;
    const weightGrew = load > seenWeight;
    const resourcesGrew = resources > seenResources;

    let dropResult = null;
    let deferred = false;

    if (drop && ((load > hard.weight && weightGrew) || (resources > hard.resources && resourcesGrew))) {
      const room = await pickRandomPublicRoom(tx, character.locationId);
      if (!room) {
        // Nowhere to put it down — unplaced, or a Location with no public room. Hold the
        // watermark back so the growth stays unclaimed and the next settle (arrival, or turn close) retries for free — advancing it here would mark the load "seen" and the shed would never happen.
        deferred = true;
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: "system",
            actionType: "carry_drop_deferred",
            targetCharacterId: character.id,
            details: { load, resources, caps, hard, seenWeight, seenResources, locationId: character.locationId },
          },
        });
      } else {
        // Shed back to the ORDINARY cap, not the ceiling — landing a character exactly on 1.5× would leave them one letter from spilling again, re-dropping every turn.
        const tags = load > hard.weight && weightGrew ? drawDrops(character.tags, load - caps.weight) : [];
        for (const t of tags) {
          // LAUNDERING CLASS (fix round, M4): the spill is an ordinary stack move, same
          // Transfer pattern as everywhere else a stack changes hands — thread dropCharacterTag's poison draw straight into the room, or the Overburdened shed would bleach a poisoned stack clean on its way to the ground.
          const { poisonedTaken, poisonPayload } = await dropCharacterTag(tx, character.id, t.tagId, t.quantity);
          await addToRoomStack(tx, room.id, t.tagId, t.quantity, {
            expiresTurn: t.expiresTurn,
            poisonedCount: poisonedTaken,
            poisonPayload,
          });
        }
        if (tags.length) load = carryWeight(applyDrops(character.tags, tags));

        const spill = resources > hard.resources && resourcesGrew ? resources - caps.resources : 0;
        if (spill > 0) {
          await moveParty(tx, { kind: "character", id: character.id, name: character.name }, -spill);
          await moveParty(tx, { kind: "room", id: room.id, name: room.name }, spill);
          resources -= spill;
        }
        over = load > caps.weight || resources > caps.resources;

        const manifest = tags.map(({ tagId, tagName, quantity }) => ({ tagId, tagName, quantity }));
        if (manifest.length || spill > 0) {
          await tx.auditLog.create({
            data: {
              actorDiscordUserId: "system",
              actionType: "carry_overflow_dropped",
              targetCharacterId: character.id,
              details: { roomId: room.id, roomName: room.name, tags: manifest, resources: spill },
            },
          });
          dropResult = {
            room,
            tags: manifest,
            resources: spill,
            character: {
              id: character.id,
              name: character.name,
              discordUserId: character.discordUserId,
              age: character.age,
              gender: character.gender,
            },
          };
        }
      }
    }

    // Advance the watermark to what they're actually carrying now — after any shed, so a
    // shed load is what the next settle compares against. The conditional WHERE is the claim: two settles racing on the same growth must not both shed, the loser sees no growth next time.
    if (!deferred && (load !== seenWeight || resources !== seenResources)) {
      await tx.character.updateMany({
        where: { id: character.id, carryWeightSeen: seenWeight, carryResourcesSeen: seenResources },
        data: { carryWeightSeen: load, carryResourcesSeen: resources },
      });
    }

    // The status tag follows the cap; a player never removes it themselves.
    const held = character.tags.find((ct) => ct.tag.slug === OVERBURDENED_SLUG);
    let granted = false;
    let removed = false;
    if (over && !held) {
      const tag = await tx.tag.findUnique({ where: { slug: OVERBURDENED_SLUG }, select: { id: true } });
      if (tag) {
        await addToStack(tx, character.id, tag.id, 1, { source: "EVENT" });
        granted = true;
      } else if (!warnedMissingTag) {
        warnedMissingTag = true;
        console.error(`settleCarry: no "${OVERBURDENED_SLUG}" tag — run npm run db:sync-tags. Carry caps won't bite.`);
      }
    } else if (!over && held) {
      await dropCharacterTag(tx, character.id, held.tagId);
      removed = true;
    }

    if (!granted && !removed && !dropResult) return null;
    return { characterId: character.id, over, granted, removed, drop: dropResult };
  });
}

// The Discord half of a drop: a DM to the character and an aliased line in the room. Run after the settle's transaction has committed.
async function deliverCarryDrop(prisma, result) {
  const drop = result?.drop;
  if (!drop) return;
  const goods = formatManifest(drop.tags, drop.resources);
  if (drop.character.discordUserId) {
    await sendDm(
      prisma,
      drop.character.discordUserId,
      `You can't carry it all any more. You leave ${goods} in ${drop.room.name}.`,
    ).catch((err) => console.error(`Carry drop DM to ${drop.character.discordUserId} failed:`, err.message));
  }
  await announceInRoom(drop.room, drop.character, "sets down more than they could carry.", [goods]);
}

module.exports = {
  MULT_SCALE,
  HARD_CAP_RATIO,
  carryMultiplier,
  carryBreakdown,
  carryWeight,
  rowWeight,
  carryCaps,
  carryHardCaps,
  carryStatus,
  carryAdmits,
  carryBonusLine,
  settleCarry,
  deliverCarryDrop,
};
