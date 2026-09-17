// What a Move pushes onto the world when it resolves, and how to take it back. The GM-facing half of adjudication needs "this Move gave the player
// 5 ⬢" and later "undo that" without ever recomputing from live state, since the sheet moves on between the two. Every push is snapshotted onto
// `Action.appliedEffects`, and revert reads ONLY that snapshot. Same rule as Request.payload vs Request.effect (docs/systemdocs/REQUESTS.md §2).
// `appliedEffects` is JSON rather than a column per pushable thing so this can grow at one entry in MOVE_EFFECTS; revert skips keys it doesn't know.

// A Move can't drive a character's balance negative; anything that would is clamped, matching db/lib/hungerPass.js. RETURNS THE ACTUAL MOVEMENT,
// since the clamp means the nominal and applied deltas differ — snapshotting the nominal and crediting it back on Unsolve would mint ⬢ from nothing.
async function addResources(tx, characterId, amount, ctx) {
  if (!amount) return 0;
  // One atomic statement, not read-then-write — a Labor confirm could race a transfer or the auto-labor pass. GREATEST is the clamp Prisma's
  // `increment` can't express, which is why this is raw. FOR UPDATE so a concurrent write can't land between the `before`/`after` reported.
  const rows = await tx.$queryRaw`
    WITH prev AS (
      SELECT "resources" AS before FROM "Character" WHERE "id" = ${characterId} FOR UPDATE
    )
    UPDATE "Character" c
    SET "resources" = GREATEST(0, prev.before + ${amount})
    FROM prev
    WHERE c."id" = ${characterId}
    RETURNING prev.before AS before, c."resources" AS after
  `;
  const before = rows[0]?.before ?? 0;
  const after = rows[0]?.after ?? before;
  const moved = after - before;
  const party = characterParty({ id: characterId });
  if (party) await recordDelta(tx, party, moved, ctx);
  // The GREATEST(0, ...) floor is the other silent burn: a debit larger than the balance destroys the shortfall instead of going negative.
  if (amount < 0 && party) {
    const shortfall = amount - moved; // both negative or zero; e.g. -5 - (-2) = -3
    if (shortfall < 0) {
      await record(tx, { from: party, to: BURN, form: "BALANCE", amount: -shortfall }, { ...ctx, reason: "CLAMP" });
    }
  }
  return moved;
}

const { characterParty, recordDelta, record, BURN } = require("./economyLedger");
const { TIRED_SLUG, EXHAUSTED_SLUG } = require("./constants");
const { rollDie } = require("./rollDie");
const { rollWithAdvantage } = require("./advantage");
const { expiryFrom } = require("./turnFormat");
const { nextLaborFatigueSlug, grantExhaustedOutright } = require("./laborFatigue");
const { TIER_TO_LABOR_DROP_TYPE, pickLaborDropOption } = require("./laborDrops");
const { reap, harvestLine } = require("./soilery");

// One entry per pushable thing. `read` decides what this Move would push right now; `apply` pushes it and returns WHAT ACTUALLY MOVED; `revert`
// takes back exactly what was snapshotted.
const MOVE_EFFECTS = {
  resources: {
    read: (action) => action.resourceDelta ?? 0,
    apply: (tx, action, value) => addResources(tx, action.characterId, value),
    revert: (tx, action, value) => addResources(tx, action.characterId, -value),
  },

  // Two Labors before a rest, tracked by db/lib/laborFatigue.js's Tired -> Exhausted ladder. A non-null resourceRollExpression means the Labor
  // gate passed and the character labored, so the payout steps them one rung up; db/lib/laborAccess.js#computeLaborAccess refuses the next Labor
  // only on Exhausted. The snapshot key stays "exhausted" (not "laborFatigue") even for a Tired grant now, or older rows stop reverting.
  exhausted: {
    read: (action) => (action.resourceRollExpression ? 1 : 0),
    apply: async (tx, action) => {
      const heldTired = await tx.characterTag.findFirst({
        where: { characterId: action.characterId, tag: { slug: TIRED_SLUG } },
        select: { id: true, expiresTurn: true },
      });
      // The Labor gate already refused an Exhausted character, so this is always Tired or nothing.
      const targetSlug = nextLaborFatigueSlug(new Set(heldTired ? [TIRED_SLUG] : []));
      if (!targetSlug) return 0; // defensive: nothing left to escalate to
      const [tag, turn] = await Promise.all([
        tx.tag.findUnique({
          where: { slug: targetSlug },
          select: { id: true, defaultDurationTurns: true },
        }),
        tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } }),
      ]);
      if (!tag || !turn) {
        if (!tag) console.error(`Labor payout: no "${targetSlug}" tag — run npm run db:sync-tags. Labor won't be limited.`);
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

  // A day spent on the Godard Factory floor: one Godflesh becomes eight Squeeze (db/lib/refinery.js). `read` can only say "this was a Labor" —
  // whether it was REFINING depends on where the character was standing, so applyRefinery decides and returns null everywhere else.
  refined: {
    read: (action) => (action.resourceRollExpression ? 1 : 0),
    apply: async (tx, action) => {
      // WHERE THE LABOR WAS FILED, not where they are standing now — a free zone move costs no Action (CARRY.md §2a), so the two can differ.
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

  // The labor drop die (docs/systemdocs/LABORDROPS.md): a 1d6 against whatever pool docs/labordrops.yaml configured for the tier that won.
  // `action.laborTier` is read rather than recomputed (see schema.prisma), so this fires for the tier that was actually priced.
  laborDrop: {
    read: (action) => (action.laborTier && action.laborTier !== "refining" ? 1 : 0),
    apply: async (tx, action) => {
      const laborType = TIER_TO_LABOR_DROP_TYPE[action.laborTier] ?? null;
      if (!laborType) return 0;
      // Skill-gated pools (Forester in the Forest, LABORDROPS.md §2a) need what the character holds RIGHT NOW. Loaded BEFORE the roll: Lucky and Scavenging both bend the die.
      const held = await tx.characterTag.findMany({
        where: { characterId: action.characterId },
        select: { tagId: true, tag: { select: { slug: true } } },
      });
      const heldTagIds = new Set(held.map((row) => row.tagId));
      const heldSlugs = new Set(held.map((row) => row.tag?.slug).filter(Boolean));
      // Lucky throws this die twice and keeps the better one. Scavenging's own bend happens INSIDE pickLaborDropOption. `roll` stays the face that
      // was actually rolled, snapshotted so Undo and the readout agree with what happened.
      const { die: roll } = rollWithAdvantage([...heldSlugs].map((slug) => ({ slug })));
      const option = await pickLaborDropOption(tx, {
        roll,
        heldSlugs,
        laborType,
        zoneId: action.zoneId ?? null,
        locationId: action.locationId ?? null,
        heldTagIds,
      });
      if (!option || option.kind === "NOTHING") return 0;

      if (option.kind === "RESOURCES") {
        const moved = await addResources(tx, action.characterId, option.resourceAmount ?? 0);
        if (!moved) return 0;
        return { roll, kind: "RESOURCES", amount: moved };
      }

      // TAG. addToStack (db/lib/tagWrites.js) increments an existing stack and pins a non-stackable tag at quantity 1, so a repeat find of the same
      // non-stackable item is a no-op. The catalog's own clock rides along — nothing backfills expiresTurn later, so a wound granted without it is
      // a PERMANENT Deep Wound. `turn.number + 1`, not bare turn.number, since at payout `turn` is the turn being CLOSED.
      const { addToStack } = require("./tagWrites");
      const turn = option.tag?.defaultDurationTurns
        ? await tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } })
        : null;
      await addToStack(tx, action.characterId, option.tagId, 1, {
        source: "EVENT",
        stackable: option.tag?.stackable === true,
        expiresTurn: turn ? expiryFrom(turn.number + 1, option.tag.defaultDurationTurns) : null,
      });
      return {
        roll,
        kind: "TAG",
        tagId: option.tagId,
        tagSlug: option.tag?.slug ?? null,
        tagName: option.tag?.name ?? "something",
      };
    },
    revert: async (tx, action, snapshot) => {
      if (!snapshot) return;
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
    else if (key === "laborDrop") {
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
