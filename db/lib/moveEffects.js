// What a Move pushes onto the world when it resolves, and how to take it back.
//
// The GM-facing half of adjudication needs to be able to say "this Move gave
// the player 5 ⬢" and later "actually, undo that" — without ever recomputing
// the number from live state, because the sheet moves on between the two.
// Every push is therefore snapshotted onto `Action.appliedEffects`, and revert
// reads ONLY that snapshot. Same rule as Request.payload vs Request.effect
// (docs/systemdocs/REQUESTS.md §2).
//
// `appliedEffects` is JSON rather than a column per pushable thing so this can
// grow — adding tags, moving a character, granting a Status — costs one entry
// in MOVE_EFFECTS below and nothing else. Old rows written before a new key
// existed still revert cleanly, because revert skips keys it doesn't know.

// A Move can't drive a character's balance negative; anything that would is
// clamped, matching db/lib/hungerPass.js.
//
// RETURNS THE ACTUAL MOVEMENT, which is the whole point. The clamp means the
// nominal delta and the applied delta are not the same number: a −5 against a
// character holding 2 ⬢ moves −2. Snapshotting the nominal −5 and then
// crediting it back on Unsolve minted 3 ⬢ out of nothing, every time. This is
// the same trap db/lib/lifeweb.js#bumpBlood documents and solves for the blood
// pool, in the same shape: clamp and report in one statement, and let the
// caller record what moved rather than what was asked for.
async function addResources(tx, characterId, amount, ctx) {
  if (!amount) return 0;
  // One atomic statement, not read-then-write. The old shape (findUnique, add
  // in JS, write the literal back) lost an update whenever anything else
  // touched the same character between the two — a Labor confirm racing a
  // transfer, or the auto-labor pass racing a player at rollover. GREATEST
  // keeps the clamp that db/lib/hungerPass.js also applies; Prisma's
  // `increment` can't express it, which is why this is raw.
  //
  // FOR UPDATE on the prior read so a concurrent write can't land between the
  // `before` this reports and the `after` it wrote.
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
  // The GREATEST(0, ...) floor above is the other silent burn this module's
  // header comment describes: a debit larger than the balance destroys the
  // shortfall instead of driving the balance negative. `moved` is what
  // actually happened and is already recorded above; the difference between
  // what was asked for and what moved is money that ceased to exist, and
  // until now nothing ever wrote that down.
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
const { nextLaborFatigueSlug } = require("./laborFatigue");
const { TIER_TO_LABOR_DROP_TYPE, pickLaborDropOption } = require("./laborDrops");

// One entry per pushable thing. `read` decides what this Move would push right
// now; `apply` pushes it and returns WHAT ACTUALLY MOVED; `revert` takes back
// exactly what was snapshotted.
const MOVE_EFFECTS = {
  resources: {
    read: (action) => action.resourceDelta ?? 0,
    apply: (tx, action, value) => addResources(tx, action.characterId, value),
    revert: (tx, action, value) => addResources(tx, action.characterId, -value),
  },

  // Two Labors before a rest, tracked by db/lib/laborFatigue.js's Tired ->
  // Exhausted ladder. A non-null resourceRollExpression means the Labor gate
  // passed and the character labored — even a roll of 0 ⬢ spent the day — so
  // the payout steps them one rung up the ladder, and
  // db/lib/laborAccess.js#computeLaborAccess refuses the next Labor only once
  // they land on Exhausted. Both payout paths (db/lib/stagedPush.js §2,
  // db/lib/autoLaborPass.js) run while the action's own turn closes, so
  // `turn.number + durationTurns` blocks exactly the following turn — the
  // same clock arithmetic as the Hunger grant in db/lib/hungerPass.js.
  //
  // The snapshot key stays "exhausted" — not "laborFatigue" — even though it
  // may record a Tired grant now: it rides on `Action.appliedEffects`, and a
  // renamed key would silently stop reverting on every Labor pushed before
  // this changed (revertMoveEffects skips a key it doesn't recognise).
  exhausted: {
    read: (action) => (action.resourceRollExpression ? 1 : 0),
    apply: async (tx, action) => {
      const heldTired = await tx.characterTag.findFirst({
        where: { characterId: action.characterId, tag: { slug: TIRED_SLUG } },
        select: { id: true, expiresTurn: true },
      });
      // The Labor gate already refused an Exhausted character, so this is
      // always Tired or nothing — nextLaborFatigueSlug is called anyway
      // rather than reimplementing its decision by hand.
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
      // Escalating: the Tired row is consumed by the upgrade, not left to
      // expire on its own — otherwise the character would end up holding
      // both, and the sweep would clear Tired out from under an Exhausted
      // that's supposed to degrade back into it.
      if (heldTired) await tx.characterTag.delete({ where: { id: heldTired.id } });
      // skipDuplicates: an existing Tired/Exhausted keeps its own clock, the
      // same "already holds it" rule as db/lib/tagExpiryPass.js. Reachable
      // only if something else granted the target tag between the read above
      // and here.
      await tx.characterTag.createMany({
        data: [{
          characterId: action.characterId,
          tagId: tag.id,
          source: "EVENT",
          expiresTurn: expiryFrom(turn.number + 1, tag.defaultDurationTurns ?? 1),
        }],
        skipDuplicates: true,
      });
      // Snapshotted for revert: which tag this granted, and — only when it
      // escalated — the exact expiry the consumed Tired row carried, so an
      // Unsolve can put the character back exactly where they were rather
      // than just stripping Exhausted and leaving them fatigue-free.
      return { slug: targetSlug, replacedTired: heldTired ? { expiresTurn: heldTired.expiresTurn } : null };
    },
    revert: async (tx, action, snapshot) => {
      // Legacy shape: rows pushed before this ladder existed recorded a bare
      // `1` here, always meaning a plain Exhausted grant with nothing to
      // restore underneath it.
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

  // A day spent on the Godard Factory floor: one Godflesh becomes eight
  // Squeeze (db/lib/refinery.js). `read` can only say "this was a Labor" —
  // whether it was a REFINING one depends on where the character was standing,
  // which is a database question, so applyRefinery decides and returns null at
  // every other Location. That is what lets this work from a bare Action row:
  // the hand-filed path (db/lib/stagedPush.js) applies at turn close with
  // nothing in memory but the row itself.
  //
  // Nothing is recorded for an ordinary Labor, so old rows and every other
  // location are untouched.
  refined: {
    read: (action) => (action.resourceRollExpression ? 1 : 0),
    apply: async (tx, action) => {
      // WHERE THE LABOR WAS FILED, not where they are standing now. A free
      // zone move costs no Action (CARRY.md §2a), so the two can differ by the
      // time this runs at turn close. Older rows carry no locationId and fall
      // back to the live one, which is what they always did.
      let locationId = action.locationId ?? null;
      if (!locationId) {
        const character = await tx.character.findUnique({
          where: { id: action.characterId },
          select: { locationId: true },
        });
        locationId = character?.locationId ?? null;
      }
      // 0, not null: applyMoveEffects falls back to the READ value when apply
      // reports nothing, so a null here would stamp `refined: 1` on every
      // ordinary Labor in the game.
      if (!locationId) return 0;
      const { applyRefinery } = require("./refinery");
      return (await applyRefinery(tx, action.characterId, locationId)) ?? 0;
    },
    revert: async (tx, action, snapshot) => {
      const { revertRefinery } = require("./refinery");
      await revertRefinery(tx, action.characterId, snapshot);
    },
  },

  // The labor drop die (docs/systemdocs/LABORDROPS.md): a 1d6 rolled against
  // whatever pool docs/labordrops.yaml configured for the tier that won,
  // combined across up to six scopes. `action.laborTier` is read rather than
  // recomputed — see its own comment in schema.prisma — so this fires for
  // exactly the tier that was actually priced, even if the character has
  // since walked somewhere else on a free zone move. No config for a roll (the
  // common case while the table is still mostly unbuilt) or a drawn NOTHING
  // entry both read as "nothing happened" and record nothing.
  laborDrop: {
    read: (action) => (action.laborTier && action.laborTier !== "refining" ? 1 : 0),
    apply: async (tx, action) => {
      const laborType = TIER_TO_LABOR_DROP_TYPE[action.laborTier] ?? null;
      if (!laborType) return 0;
      // Skill-gated pools (Forester in the Forest, LABORDROPS.md §2a) need to
      // know what the character actually holds RIGHT NOW — a skill learned
      // since filing should count, the same live-state reasoning
      // resolveLaborRate already uses for the tier itself. Loaded BEFORE the
      // roll now, because Lucky and Scavenging both bend the die.
      const held = await tx.characterTag.findMany({
        where: { characterId: action.characterId },
        select: { tagId: true, tag: { select: { slug: true } } },
      });
      const heldTagIds = new Set(held.map((row) => row.tagId));
      const heldSlugs = new Set(held.map((row) => row.tag?.slug).filter(Boolean));
      // Lucky throws this die twice and keeps the better one. Scavenging's own
      // bend happens INSIDE pickLaborDropOption, because it depends on whether
      // the rolled face has a pool at all — see the note there. `roll` stays
      // the face that was actually rolled, which is what gets snapshotted onto
      // appliedEffects so Undo and the readout agree with what happened.
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

      // TAG. addToStack is the shared primitive (db/lib/tagWrites.js) — it
      // increments an existing stack rather than minting a second row, and
      // pins a non-stackable tag at quantity 1 no matter how many times it's
      // drawn, so a repeat find of the same non-stackable item is a no-op
      // grant rather than an error.
      //
      // The catalog's own clock rides along, the same way the `exhausted`
      // effect above stamps one: nothing backfills expiresTurn from the
      // catalog later (tagExpiryPass.js queries ON the column), so a wound
      // granted without it is a PERMANENT Deep Wound. `turn.number + 1`, not
      // a bare turn.number — at a Labor payout `turn` is the turn being
      // CLOSED, so the clock starts on the next one. A find with no
      // durationTurns (an obol, a corpse) stamps null and never expires,
      // which is what expiryFrom already does with a nullish duration.
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
};

// Pushes everything this Move is worth and returns the blob to stamp on
// `Action.appliedEffects`. Callers run this inside their own transaction.
//
// The snapshot records what `apply` reports moving, not what `read` asked for.
// An effect whose apply returns nothing falls back to the asked-for value, so
// a future entry that can't clamp doesn't have to say so.
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

// Hands back exactly what `appliedEffects` says was pushed. An unknown key is
// skipped rather than thrown, so a row written before a newer effect existed
// still unsolves instead of wedging the panel.
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
    // Legacy rows recorded a bare `1`, always meaning a plain Exhausted grant.
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
    else parts.push(`${key}: ${value}`);
  }
  return parts.join(", ");
}

// The Move d6 moved to db/lib/rollDie.js so advantage.js could reach it
// without requiring this file back (see the note there). Still re-exported
// below, so every existing importer keeps working unchanged.

// addResources is exported for db/lib/stagedPush.js, which pushes GM-staged
// resource adjustments through the same clamp-and-report statement.
module.exports = { addResources, applyMoveEffects, revertMoveEffects, describeMoveEffects, rollDie };
