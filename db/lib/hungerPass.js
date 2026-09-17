// Per-turn Hunger upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
// See TURN-ENGINE.md for the full ordering.
//
// The 0-30 meter itself (thresholds, decay, banding) lives in the
// Prisma-free db/lib/hunger.js — this file is the Prisma-in-tx half: reading
// every ALIVE character's hungerValue, writing the decay, and granting/
// dropping the hungry/starving tags and the eventual dying tag off it.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const {
  HUNGER_SLUG,
  STARVING_SLUG,
  HUNGERLESS_SLUG,
  FAST_METABOLISM_SLUG,
  DYING_SLUG,
} = require("./constants");
const { expiryFrom } = require("./turnFormat");
const { applyMood } = require("./mood");
const { alivePassCharacters } = require("./aliveCharacters");
const {
  HUNGRY_THRESHOLD,
  STARVING_THRESHOLD,
  STARVING_DEATH_TURNS,
  clampHunger,
  decayFor,
  crossings,
  hungerDm,
  DYING_DM,
} = require("./hunger");

async function runHungerPass(prisma, turn, { bornBefore } = {}) {
  const tags = await prisma.tag.findMany({
    where: {
      slug: {
        in: [HUNGER_SLUG, STARVING_SLUG, HUNGERLESS_SLUG, FAST_METABOLISM_SLUG, DYING_SLUG],
      },
    },
    select: { id: true, slug: true, defaultDurationTurns: true },
  });

  const hungryTag = tags.find((t) => t.slug === HUNGER_SLUG);
  const starvingTag = tags.find((t) => t.slug === STARVING_SLUG);
  if (!hungryTag || !starvingTag) {
    console.error(
      `Hunger pass skipped: no "${HUNGER_SLUG}"/"${STARVING_SLUG}" tag — run npm run db:sync-tags.`,
    );
    return null;
  }
  const hungerlessId = tags.find((t) => t.slug === HUNGERLESS_SLUG)?.id ?? null;
  // Missing is non-fatal, unlike the two band tags above: nobody holds it,
  // so everyone just decays at the flat rate.
  const fastMetabolismId = tags.find((t) => t.slug === FAST_METABOLISM_SLUG)?.id ?? null;
  if (!fastMetabolismId) {
    console.error(
      `Hunger pass: no "${FAST_METABOLISM_SLUG}" tag — run npm run db:sync-tags. Everyone decays at the flat rate.`,
    );
  }
  const dyingId = tags.find((t) => t.slug === DYING_SLUG)?.id ?? null;
  if (!dyingId) {
    console.error(`Hunger pass: no "${DYING_SLUG}" tag — run npm run db:sync-tags. Starving to death won't grant it.`);
  }

  // Only the two gating tags — Hungerless (pins the meter) and Fast
  // Metabolism (doubles the decay). Hungry/Starving/Dying are this pass's
  // OUTPUT, computed off hungerValue itself, not read as input. Keeps this
  // cheap at 100+ characters, same reasoning as the old streak-based pass.
  const gateIds = [hungerlessId, fastMetabolismId].filter(Boolean);
  // A character born mid-close (see db/index.js#resolveNeeds) wasn't alive
  // for the turn that's closing — exclude them from this run's decay rather
  // than charge a body for a day it never had.
  const characters = await alivePassCharacters(prisma, {
    where: bornBefore ? { createdAt: { lt: bornBefore } } : undefined,
    select: {
      id: true,
      discordUserId: true,
      hungerValue: true,
      starvingSinceTurn: true,
      tags: { where: { tagId: { in: gateIds } }, select: { tagId: true } },
    },
  });

  const hungerlessIds = [];
  // Split by decay rate, then again by whether the floor bites, mirroring
  // the structural-clamp discipline the old pass used for resources: the
  // WHERE guard matches its own decrement, so hungerValue can never go
  // negative without a Math.max.
  const normalDecayIds = [];
  const normalFloorIds = [];
  const fastDecayIds = [];
  const fastFloorIds = [];

  const hungryGrantIds = [];
  const hungryDropIds = [];
  const starvingGrantIds = [];
  const starvingDropIds = [];
  const starvingSinceStampIds = [];
  const starvingSinceClearIds = [];
  const enteredHungryIds = [];
  const enteredStarvingIds = [];
  const newlyDyingIds = [];
  const hungerNotices = [];

  let decayed = 0;

  for (const character of characters) {
    const heldTagIds = new Set(character.tags.map((ct) => ct.tagId));

    if (hungerlessId && heldTagIds.has(hungerlessId)) {
      hungerlessIds.push(character.id);
      continue;
    }

    decayed += 1;
    const fastMetabolism = Boolean(fastMetabolismId && heldTagIds.has(fastMetabolismId));
    const heldSlugs = fastMetabolism ? new Set([FAST_METABOLISM_SLUG]) : new Set();
    const decay = decayFor(heldSlugs);

    const before = character.hungerValue;
    const after = clampHunger(before - decay);

    if (fastMetabolism) {
      if (before >= decay) fastDecayIds.push(character.id);
      else fastFloorIds.push(character.id);
    } else if (before >= decay) {
      normalDecayIds.push(character.id);
    } else {
      normalFloorIds.push(character.id);
    }

    const cross = crossings(before, after);

    if (after <= HUNGRY_THRESHOLD) hungryGrantIds.push(character.id);
    else hungryDropIds.push(character.id);
    if (after <= STARVING_THRESHOLD) starvingGrantIds.push(character.id);
    else starvingDropIds.push(character.id);

    let effectiveStarvingSinceTurn = character.starvingSinceTurn ?? null;
    if (cross.enteredStarving && effectiveStarvingSinceTurn == null) {
      effectiveStarvingSinceTurn = turn.number;
      starvingSinceStampIds.push(character.id);
    } else if (cross.leftStarving && effectiveStarvingSinceTurn != null) {
      effectiveStarvingSinceTurn = null;
      starvingSinceClearIds.push(character.id);
    }

    const isNewlyDying =
      dyingId != null &&
      after <= STARVING_THRESHOLD &&
      effectiveStarvingSinceTurn != null &&
      turn.number - effectiveStarvingSinceTurn >= STARVING_DEATH_TURNS - 1;
    if (isNewlyDying) newlyDyingIds.push(character.id);

    if (cross.enteredHungry) enteredHungryIds.push(character.id);
    if (cross.enteredStarving) enteredStarvingIds.push(character.id);

    // One DM per newly-entered band (never one per point of decay) —
    // Starving's line wins if both would somehow fire on the same close,
    // matching the Gambit modifier's "Starving wins outright" rule. A
    // character not freshly entering either band, and not newly dying,
    // hears nothing this turn — decay is silent until it crosses a line.
    if (cross.enteredStarving || isNewlyDying) {
      hungerNotices.push({ discordUserId: character.discordUserId, kind: "starving", justDied: isNewlyDying });
    } else if (cross.enteredHungry) {
      hungerNotices.push({ discordUserId: character.discordUserId, kind: "hungry", justDied: false });
    }
  }

  const hungryExpiresTurn = expiryFrom(turn.number + 1, hungryTag.defaultDurationTurns ?? 1);
  const starvingExpiresTurn = expiryFrom(turn.number + 1, starvingTag.defaultDurationTurns ?? 1);

  // One transaction: a character can't land at a new hungerValue without the
  // matching band tags landing with it, or reach the death timer without
  // `dying` granted in the same beat.
  await prisma.$transaction([
    prisma.character.updateMany({
      where: { id: { in: hungerlessIds } },
      data: { hungerValue: 30, starvingSinceTurn: null },
    }),
    prisma.character.updateMany({
      where: { id: { in: normalDecayIds } },
      data: { hungerValue: { decrement: 3 } },
    }),
    prisma.character.updateMany({
      where: { id: { in: normalFloorIds } },
      data: { hungerValue: 0 },
    }),
    prisma.character.updateMany({
      where: { id: { in: fastDecayIds } },
      data: { hungerValue: { decrement: 6 } },
    }),
    prisma.character.updateMany({
      where: { id: { in: fastFloorIds } },
      data: { hungerValue: 0 },
    }),
    prisma.characterTag.createMany({
      data: hungryGrantIds.map((characterId) => ({
        characterId,
        tagId: hungryTag.id,
        source: "EVENT",
        expiresTurn: hungryExpiresTurn,
      })),
      skipDuplicates: true,
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: hungryDropIds }, tagId: hungryTag.id },
    }),
    prisma.characterTag.createMany({
      data: starvingGrantIds.map((characterId) => ({
        characterId,
        tagId: starvingTag.id,
        source: "EVENT",
        expiresTurn: starvingExpiresTurn,
      })),
      skipDuplicates: true,
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: starvingDropIds }, tagId: starvingTag.id },
    }),
    prisma.character.updateMany({
      where: { id: { in: starvingSinceStampIds } },
      data: { starvingSinceTurn: turn.number },
    }),
    prisma.character.updateMany({
      where: { id: { in: starvingSinceClearIds } },
      data: { starvingSinceTurn: null },
    }),
    ...(newlyDyingIds.length && dyingId
      ? [
          prisma.characterTag.createMany({
            data: newlyDyingIds.map((characterId) => ({
              characterId,
              tagId: dyingId,
              source: "EVENT",
              // One-turn clock: granted at close N, expires N + 1, then
              // db/lib/dyingDeathPass.js takes over. Kept granting it the
              // same way turn after turn while nothing changes — a GM
              // confirms the death by hand, same as every other terminal
              // chain (tagExpiryPass.js).
              expiresTurn: turn.number + 1,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  // Starving to death's door is frightening (docs/systemdocs/MOOD.md). These
  // ride after the transaction, the same pattern the old pass used for its
  // DYING mood hit — a batch createMany can't carry a per-row mood term, so
  // the dial moves here, once the grant has landed. Each list only ever
  // holds a FRESH crossing this turn, so nobody is charged twice for
  // remaining in a band they already occupied.
  const moodDms = [];
  for (const characterId of enteredHungryIds) {
    const moved = await applyMood(prisma, characterId, { kind: "HUNGRY_ONSET", notify: false }).catch((err) => {
      console.error(`Hunger pass: hungry onset mood failed for ${characterId}:`, err.message ?? err);
      return null;
    });
    if (moved?.dm) moodDms.push(moved.dm);
  }
  for (const characterId of enteredStarvingIds) {
    const moved = await applyMood(prisma, characterId, { kind: "STARVING_ONSET", notify: false }).catch((err) => {
      console.error(`Hunger pass: starving onset mood failed for ${characterId}:`, err.message ?? err);
      return null;
    });
    if (moved?.dm) moodDms.push(moved.dm);
  }
  for (const characterId of newlyDyingIds) {
    const moved = await applyMood(prisma, characterId, { kind: "DYING", notify: false }).catch((err) => {
      console.error(`Hunger pass: dying mood failed for ${characterId}:`, err.message ?? err);
      return null;
    });
    if (moved?.dm) moodDms.push(moved.dm);
  }

  // DMs are deliberately NOT sent here — the list is handed back and sent
  // from advanceTurn()'s runSideEffects() instead, after the response
  // already flushed.
  return {
    turnNumber: turn.number,
    decayed,
    skipped: hungerlessIds.length,
    enteredHungry: enteredHungryIds.length,
    enteredStarving: enteredStarvingIds.length,
    newlyDying: newlyDyingIds.length,
    hungerNotices,
    moodDms,
    newlyDyingCharacterIds: newlyDyingIds,
  };
}

module.exports = {
  runHungerPass,
  hungerDm,
  DYING_DM,
};
