// What a Move pushes onto the world when it resolves, and how to take it back. The GM-facing half of adjudication needs "this Move gave the player
// 5 ⬢" and later "undo that" without ever recomputing from live state, since the sheet moves on between the two. Every push is snapshotted onto
// `Action.appliedEffects`, and revert reads ONLY that snapshot. Same rule as Request.payload vs Request.effect (docs/systemdocs/REQUESTS.md §2).
// `appliedEffects` is JSON rather than a column per pushable thing so this can grow at one entry in MOVE_EFFECTS; revert skips keys it doesn't know.

// A Move can't drive a character's balance negative; anything that would is clamped. RETURNS THE ACTUAL MOVEMENT,
// since the clamp means the nominal and applied deltas differ — snapshotting the nominal and crediting it back on Unsolve would mint ⬢ from nothing.
async function addResources(tx, characterId, amount, ctx) {
  if (!amount) return 0;
  // The clamp and the atomicity both live in db/lib/resourceStack.js now — this used to be raw SQL with a GREATEST(0, ...) against
  // Character.resources, and there is no such column since ⬢ became a stack.
  const { moved, clamped } = await addCharacterResources(tx, characterId, amount);
  const party = characterParty({ id: characterId });
  if (moved && party) await recordDelta(tx, party, moved, ctx);
  // The floor is the other silent burn: a debit larger than the balance destroys the shortfall instead of going negative.
  if (party && clamped > 0) {
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount: clamped }, { ...ctx, reason: "CLAMP" });
  }
  return moved;
}

const { characterParty, recordDelta, record, BURN } = require("./economyLedger");
const { addCharacterResources } = require("./resourceStack");
const { TIRED_SLUG, EXHAUSTED_SLUG } = require("./constants");
const { rollDie } = require("./rollDie");
const { expiryFrom } = require("./turnFormat");
const { nextFatigueSlug, grantExhaustedOutright } = require("./fatigue");
const { drawProspectingLoot } = require("./cavingLoot");
const { PROSPECTING_SLUG } = require("./constants");
const { AUTO_MINE_NOTE, AUTO_REFINE_NOTE } = require("./constants");
const { reap, harvestLine } = require("./soilery");

// One entry per pushable thing. `read` decides what this Move would push right now; `apply` pushes it and returns WHAT ACTUALLY MOVED; `revert`
// takes back exactly what was snapshotted.
const MOVE_EFFECTS = {
  resources: {
    read: (action) => action.resourceDelta ?? 0,
    apply: (tx, action, value) => addResources(tx, action.characterId, value, { reason: "MINING" }),
    revert: (tx, action, value) => addResources(tx, action.characterId, -value),
  },

  // Two days in the seam before a rest, tracked by db/lib/fatigue.js's Tired -> Exhausted ladder. Mining is the one thing that climbs it from a
  // Move — db/lib/mining.js#computeMiningAccess refuses the next day only on Exhausted. Gated on the Mine button's own marker. The snapshot key stays
  // "exhausted" even for a Tired grant, or older rows stop reverting.
  exhausted: {
    read: (action) => (action.gmNotes === AUTO_MINE_NOTE ? 1 : 0),
    apply: async (tx, action) => {
      const heldTired = await tx.characterTag.findFirst({
        where: { characterId: action.characterId, tag: { slug: TIRED_SLUG } },
        select: { id: true, expiresTurn: true },
      });
      // The Mine gate already refused an Exhausted character, so this is always Tired or nothing.
      const targetSlug = nextFatigueSlug(new Set(heldTired ? [TIRED_SLUG] : []));
      if (!targetSlug) return 0; // defensive: nothing left to escalate to
      const [tag, turn] = await Promise.all([
        tx.tag.findUnique({
          where: { slug: targetSlug },
          select: { id: true, defaultDurationTurns: true },
        }),
        tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } }),
      ]);
      if (!tag || !turn) {
        if (!tag) console.error(`Mining payout: no "${targetSlug}" tag — run npm run db:sync-tags. Mining won't be limited.`);
        return 0;
      }
      // Escalating: the Tired row is consumed by the upgrade, or the character ends up holding both.
      if (heldTired) await tx.characterTag.delete({ where: { id: heldTired.id } });
      // skipDuplicates: an existing Tired/Exhausted keeps its own clock (same rule as db/lib/tagExpiryPass.js).
      await tx.characterTag.createMany({
        data: [{
          characterId: action.characterId,
          tagId: tag.id,
          source: "EVENT",
          expiresTurn: expiryFrom(turn.number + 1, tag.defaultDurationTurns ?? 1),
        }],
        skipDuplicates: true,
      });
      // Snapshotted for revert: which tag this granted, and (if escalated) the exact expiry the consumed Tired row carried.
      return { slug: targetSlug, replacedTired: heldTired ? { expiresTurn: heldTired.expiresTurn } : null };
    },
    revert: async (tx, action, snapshot) => {
      // Legacy shape: rows pushed before this ladder existed recorded a bare `1`, always meaning a plain Exhausted grant.
      const grantedSlug = snapshot && typeof snapshot === "object" ? snapshot.slug : EXHAUSTED_SLUG;
      const grantedTag = await tx.tag.findUnique({ where: { slug: grantedSlug }, select: { id: true } });
      if (grantedTag) {
        await tx.characterTag.deleteMany({ where: { characterId: action.characterId, tagId: grantedTag.id } });
      }
      const replacedTired = snapshot && typeof snapshot === "object" ? snapshot.replacedTired : null;
      if (replacedTired) {
        const tiredTag = await tx.tag.findUnique({ where: { slug: TIRED_SLUG }, select: { id: true } });
        if (tiredTag) {
          await tx.characterTag.createMany({
            data: [{
              characterId: action.characterId,
              tagId: tiredTag.id,
              source: "EVENT",
              expiresTurn: replacedTired.expiresTurn,
            }],
            skipDuplicates: true,
          });
        }
      }
    },
  },

  // A day spent on the Godard Factory floor: one Godflesh becomes eight Squeeze (db/lib/refinery.js). Filed by the Refine button, which is the
  // only thing that stamps this marker.
  refined: {
    read: (action) => (action.gmNotes === AUTO_REFINE_NOTE ? 1 : 0),
    apply: async (tx, action) => {
      // WHERE THE REFINE WAS FILED, not where they are standing now — a free zone move costs no Action (CARRY.md §2a), so the two can differ.
      let locationId = action.locationId ?? null;
      if (!locationId) {
        const character = await tx.character.findUnique({
          where: { id: action.characterId },
          select: { locationId: true },
        });
        locationId = character?.locationId ?? null;
      }
      // 0, not null: applyMoveEffects falls back to the READ value when apply reports nothing.
      if (!locationId) return 0;
      const { applyRefinery } = require("./refinery");
      return (await applyRefinery(tx, action.characterId, locationId)) ?? 0;
    },
    revert: async (tx, action, snapshot) => {
      const { revertRefinery } = require("./refinery");
      await revertRefinery(tx, action.characterId, snapshot);
    },
  },

  // The prospecting loot roll (docs/systemdocs/MINING.md). Only a Mine draws it — this is what mining pays in stone rather than in ⬢, and nothing
  // else is digging. It reuses the Caving Die's table machinery (db/lib/cavingLoot.js), which is why there is no YAML behind it: the whole
  // MiningDropOption subsystem it replaced was deleted on 2026-09-18.
  //
  // TWO gates, and they are different refusals. No Prospecting: no roll at all, ever — the skill is what turns rock into ore you can recognise
  // (db/lib/mining.js). No column for the zone: no roll either, but that one is ordinary — the Black Hills are minable for ⬢ and hold nothing worth
  // finding.
  //
  // The key, the AUTO_MINE_NOTE trigger and the { kind: "TAG", tagId, ... } snapshot shape are all unchanged on purpose, so Action rows written
  // under the old die still revert through the arm below.
  miningDrop: {
    read: (action) => (action.gmNotes === AUTO_MINE_NOTE ? 1 : 0),
    apply: async (tx, action) => {
      const prospecting = await tx.characterTag.findFirst({
        where: { characterId: action.characterId, tag: { slug: PROSPECTING_SLUG } },
        select: { id: true },
      });
      if (!prospecting) return 0;

      // The table is keyed by zone SLUG; the Action carries the id it was filed at, which is the right one to read — a character who walked out of
      // the caves after pressing Mine still dug where they dug.
      const zone = action.zoneId
        ? await tx.zone.findUnique({ where: { id: action.zoneId }, select: { slug: true } })
        : null;
      const drawn = zone ? drawProspectingLoot(zone.slug) : null;
      if (!drawn) return 0;

      const tag = await tx.tag.findUnique({
        where: { slug: drawn.slug },
        select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true },
      });
      if (!tag) {
        // Catalog out of sync with cavingLoot.js. validateCavingLoot() at startup exists precisely so this never fires; if it does, swallow it —
        // a phantom tag must not take the ⬢ payout down with it.
        console.error(`Prospecting loot: tier "${drawn.tier}" drew unknown tag "${drawn.slug}" — run npm run db:sync-tags.`);
        return 0;
      }

      // addToStack (db/lib/tagWrites.js) increments an existing stack and pins a non-stackable tag at quantity 1, so a repeat find of the same
      // non-stackable item is a no-op. The catalog's own clock rides along — nothing backfills expiresTurn later. `turn.number + 1`, not bare
      // turn.number, since at payout `turn` is the turn being CLOSED.
      const { addToStack } = require("./tagWrites");
      const turn = tag.defaultDurationTurns
        ? await tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } })
        : null;
      await addToStack(tx, action.characterId, tag.id, 1, {
        source: "EVENT",
        stackable: tag.stackable === true,
        expiresTurn: turn ? expiryFrom(turn.number + 1, tag.defaultDurationTurns) : null,
      });
      return { kind: "TAG", tier: drawn.tier, tagId: tag.id, tagSlug: tag.slug, tagName: tag.name ?? "something" };
    },
    revert: async (tx, action, snapshot) => {
      if (!snapshot) return;
      // RESOURCES is the old die's shape — kept so a row pushed before 2026-09-18 still reverts. Nothing writes it any more.
      if (snapshot.kind === "RESOURCES") {
        await addResources(tx, action.characterId, -snapshot.amount);
        return;
      }
      if (snapshot.kind === "TAG" && snapshot.tagId) {
        const { dropCharacterTag } = require("./tagWrites");
        await dropCharacterTag(tx, action.characterId, snapshot.tagId, 1);
      }
    },
  },

  // Soilery (db/lib/soilery.js, docs' Soilery plan §B6): a Farm Move commits at press — the seed
  // bag's licence is spent and gone the moment `farmRequestImpl` files it — but the wither die and
  // the Exhausted lockout only land here, at push, exactly like `refined` above. `action.farmPlan`
  // is `{ v: 1, rows: [{ slug, tagId, tagName, planted }, ...] }`, written by farmRequestImpl.
  farmed: {
    read: (action) => (action.farmPlan?.rows?.length ? 1 : 0),
    apply: async (tx, action) => {
      const plan = action.farmPlan;
      const tagIds = plan.rows.map((row) => row.tagId);
      const tags = await tx.tag.findMany({
        where: { id: { in: tagIds } },
        select: { id: true, stackable: true },
      });
      const stackableById = new Map(tags.map((tag) => [tag.id, tag.stackable]));

      const rows = [];
      for (const row of plan.rows) {
        const reaped = reap(row.planted);
        if (reaped > 0) {
          const { addToStack } = require("./tagWrites");
          await addToStack(tx, action.characterId, row.tagId, reaped, {
            source: "EVENT",
            stackable: stackableById.get(row.tagId) ?? true,
          });
        }
        // `cropName` (not `tagName`) on the way out — harvestLine()/farmDm() read this shape,
        // matching what a stored farmPlan row is named going IN versus what a resolved harvest
        // row is named coming OUT.
        rows.push({
          slug: row.slug,
          tagId: row.tagId,
          cropName: row.tagName,
          planted: row.planted,
          reaped,
        });
      }

      // Never `tired` directly (Context §2 of the plan): a day at the plough grants Exhausted
      // OUTRIGHT, replacing a held Tired rather than escalating through it.
      const turn = await tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } });
      const fatigue = turn ? await grantExhaustedOutright(tx, action.characterId, turn.number) : null;

      return { rows, fatigue };
    },
    revert: async (tx, action, snapshot) => {
      if (!snapshot) return;
      const { dropCharacterTag } = require("./tagWrites");
      for (const row of snapshot.rows ?? []) {
        if (row.reaped > 0) await dropCharacterTag(tx, action.characterId, row.tagId, row.reaped);
      }
      const fatigue = snapshot.fatigue;
      if (!fatigue) return;
      const exhaustedTag = await tx.tag.findUnique({ where: { slug: EXHAUSTED_SLUG }, select: { id: true } });
      if (exhaustedTag) {
        await tx.characterTag.deleteMany({ where: { characterId: action.characterId, tagId: exhaustedTag.id } });
      }
      if (fatigue.replacedTired) {
        const tiredTag = await tx.tag.findUnique({ where: { slug: TIRED_SLUG }, select: { id: true } });
        if (tiredTag) {
          await tx.characterTag.createMany({
            data: [{
              characterId: action.characterId,
              tagId: tiredTag.id,
              source: "EVENT",
              expiresTurn: fatigue.replacedTired.expiresTurn,
            }],
            skipDuplicates: true,
          });
        }
      }
    },
  },
};

// Pushes everything this Move is worth and returns the blob to stamp on `Action.appliedEffects`. Callers run this inside their own transaction.
// The snapshot records what `apply` reports moving, not what `read` asked for; apply returning nothing falls back to the asked-for value.
async function applyMoveEffects(tx, action) {
  const applied = {};
  for (const [key, effect] of Object.entries(MOVE_EFFECTS)) {
    const value = effect.read(action);
    if (!value) continue;
    const moved = await effect.apply(tx, action, value);
    const recorded = moved === undefined || moved === null ? value : moved;
    if (recorded) applied[key] = recorded;
  }
  return applied;
}

// Hands back exactly what `appliedEffects` says was pushed. An unknown key is skipped rather than thrown, so an old row still unsolves.
async function revertMoveEffects(tx, action) {
  const applied = action.appliedEffects ?? {};
  for (const [key, value] of Object.entries(applied)) {
    const effect = MOVE_EFFECTS[key];
    if (!effect || !value) continue;
    await effect.revert(tx, action, value);
  }
  return applied;
}

// "+5 ⬢" — the one-line human form of a snapshot, for panels and audit rows.
function describeMoveEffects(applied) {
  const parts = [];
  for (const [key, value] of Object.entries(applied ?? {})) {
    if (!value) continue;
    if (key === "resources") parts.push(`${value > 0 ? "+" : ""}${value} ⬢`);
    // Legacy rows recorded a bare `1`.
    else if (key === "exhausted") parts.push(value?.slug === TIRED_SLUG ? "Tired" : "Exhausted");
    // The ⬢ arm is the old mining drop die's shape (pre-2026-09-18); nothing writes it any more,
    // but rows from that era still print.
    else if (key === "miningDrop") {
      parts.push(
        value.kind === "TAG"
          ? `found ${value.tagName}`
          : `${value.amount > 0 ? "+" : ""}${value.amount} ⬢ (find)`,
      );
    }
    else if (key === "refined") {
      parts.push(
        value.empty
          ? "nothing to refine — no Godflesh here"
          : `+${value.produced?.quantity ?? 0} Squeeze, −1 Godflesh`,
      );
    }
    else if (key === "farmed") parts.push(harvestLine(value.rows));
    else parts.push(`${key}: ${value}`);
  }
  return parts.join(", ");
}

// The Move d6 lives in db/lib/rollDie.js so advantage.js can reach it without requiring this file back; still re-exported below.
// addResources is exported for db/lib/stagedPush.js, which pushes GM-staged resource adjustments through the same clamp-and-report statement.
module.exports = { addResources, applyMoveEffects, revertMoveEffects, describeMoveEffects, rollDie };
