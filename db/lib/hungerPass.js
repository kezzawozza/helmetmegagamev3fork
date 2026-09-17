// Per-turn Hunger, run from db/index.js#resolveNeeds() so the bot's cron
// advance and the Dev Panel's "End turn" button behave identically.
// See TURN-ENGINE.md for the full ordering.
//
// This pass used to BILL a character 1 ⬢ a turn (2 with Fast Metabolism) to
// feed themselves, and go hungry only if they could not cover it. That is
// gone as of 9/2026: eating is an act, not a direct debit. The only question
// now is whether they ate — whether an `ate-meal` tag is on the sheet when
// the turn closes — and food is what puts it there (docs/systemdocs/COOKING.md).
// A meal already costs ⬢ to cook, so the old charge was a second bill for the
// same dinner; the players who never cooked simply paid a silent tax for
// existing.
//
// Everything downstream is unchanged, because none of it was ever keyed to the
// money: the streak still climbs, `hungry` still costs Gambits
// (db/lib/gambitModifier.js), six straight turns still ends in Dying, and the
// mood pass still reads the streak. Only the till is gone.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
// FAST_METABOLISM_SLUG is deliberately NOT here any more. Its whole mechanic
// was doubling this pass's ⬢ charge to 2, and there is no charge to double —
// the tag is inert until the foodstuff work gives it something to mean (say,
// needing two meals a turn). It is left in the catalog rather than retired so
// that work has something to hang off; see docs/systemdocs/TURN-ENGINE.md §5.
const { HUNGER_SLUG, HUNGERLESS_SLUG, ATE_MEAL_SLUG, DYING_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");
const { applyMood } = require("./mood");
const { alivePassCharacters } = require("./aliveCharacters");

const HUNGER_STREAK_CAP = 6;

// `notice.streak` is the count AFTER this turn's change, already clamped to
// HUNGER_STREAK_CAP, matching gambitModifier.js's penalty.
function hungerDm(notice) {
  if (notice.kind === "recovered") {
    return "You ate, and you're back to full strength.";
  }
  if (notice.kind === "recovering") {
    return `You ate, but you're still weak from hunger. −${notice.streak} to Gambits.`;
  }
  return `You went hungry this turn. −${notice.streak} to Gambits.`;
}

const DYING_DM =
  "You haven't eaten in 6 turns straight. Your body is giving out — you're **Dying**. A GM will decide what happens next.";

async function runHungerPass(prisma, turn, { bornBefore } = {}) {
  const tags = await prisma.tag.findMany({
    where: {
      slug: {
        in: [HUNGER_SLUG, HUNGERLESS_SLUG, ATE_MEAL_SLUG, DYING_SLUG],
      },
    },
    select: { id: true, slug: true, defaultDurationTurns: true },
  });

  const hungerTag = tags.find((t) => t.slug === HUNGER_SLUG);
  if (!hungerTag) {
    console.error(`Hunger pass skipped: no "${HUNGER_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }
  const hungerlessId = tags.find((t) => t.slug === HUNGERLESS_SLUG)?.id ?? null;
  const ateMealId = tags.find((t) => t.slug === ATE_MEAL_SLUG)?.id ?? null;
  const dyingId = tags.find((t) => t.slug === DYING_SLUG)?.id ?? null;
  if (!dyingId) {
    console.error(`Hunger pass: no "${DYING_SLUG}" tag — run npm run db:sync-tags. Streak cap won't grant it.`);
  }

  // A noble's dinner is no longer this pass's business: skipping it costs
  // a mood hit at the mood pass instead (db/lib/moodPass.js, the `dined` marker).
  const gateIds = [hungerlessId, ateMealId].filter(Boolean);
  // A character born mid-close (see db/index.js#resolveNeeds) wasn't alive for
  // the turn that's closing — exclude them rather than mark a body hungry for
  // a day it never had.
  const characters = await alivePassCharacters(prisma, {
    where: bornBefore ? { createdAt: { lt: bornBefore } } : undefined,
    select: {
      id: true,
      discordUserId: true,
      hungerStreak: true,
      // Only the gating tags, not the whole tag set — keeps this cheap at
      // 100+ characters.
      tags: { where: { tagId: { in: gateIds } }, select: { tagId: true } },
    },
  });

  const toStarve = [];
  const shieldedIds = [];
  const toZeroIds = []; // hungerless only: streak -> 0
  const fed = []; // ate a meal: streak drops by ONE tick
  let skipped = 0;

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tagId));

    if (hungerlessId && held.has(hungerlessId)) {
      skipped += 1;
      toZeroIds.push(character.id);
      continue;
    }

    if (ateMealId && held.has(ateMealId)) {
      shieldedIds.push(character.id);
      fed.push(character);
      continue;
    }

    // Nothing else feeds anybody. No meal on the sheet is a hungry turn, and
    // ⬢ in a pocket buy nothing here any more — raw material is not dinner.
    toStarve.push(character);
  }

  const expiresTurn = expiryFrom(turn.number + 1, hungerTag.defaultDurationTurns ?? 1);

  // Computed in JS off the streak already loaded above, since an
  // increment/decrement in the same transaction wouldn't hand back the new
  // value, and this pass needs it now to decide the DMs.
  const fedWithNewStreak = fed.map((character) => ({
    character,
    newStreak: Math.max(character.hungerStreak - 1, 0),
  }));
  const stillHungryAfterEating = fedWithNewStreak.filter((f) => f.newStreak > 0);
  const toDecrementIds = fed.map((character) => character.id);

  const hungerNotices = [
    ...toStarve.map((character) => ({
      discordUserId: character.discordUserId,
      kind: "starved",
      streak: Math.min(character.hungerStreak + 1, HUNGER_STREAK_CAP),
      justDied: dyingId != null && character.hungerStreak + 1 >= HUNGER_STREAK_CAP,
    })),
    ...fedWithNewStreak
      .filter((f) => f.character.hungerStreak > 0)
      .map((f) => ({
        discordUserId: f.character.discordUserId,
        kind: f.newStreak > 0 ? "recovering" : "recovered",
        streak: f.newStreak,
        justDied: false,
      })),
  ];
  const newlyDyingIds = dyingId
    ? toStarve.filter((character) => character.hungerStreak + 1 >= HUNGER_STREAK_CAP).map((character) => character.id)
    : [];

  // One transaction so a character can't have their Ate Meal eaten without the
  // streak moving with it, or land at the streak cap without Dying landing too.
  await prisma.$transaction([
    prisma.characterTag.deleteMany({
      where: { characterId: { in: shieldedIds }, tagId: ateMealId ?? "" },
    }),
    prisma.characterTag.createMany({
      data: [...toStarve, ...stillHungryAfterEating.map((f) => f.character)].map((character) => ({
        characterId: character.id,
        tagId: hungerTag.id,
        source: "EVENT",
        expiresTurn,
      })),
      skipDuplicates: true,
    }),
    prisma.character.updateMany({
      where: { id: { in: toZeroIds } },
      data: { hungerStreak: 0 },
    }),
    // Floor is structural rather than a Math.max on an earlier read — the
    // `gt: 0` where-guard is its own clamp.
    prisma.character.updateMany({
      where: { id: { in: toDecrementIds }, hungerStreak: { gt: 0 } },
      data: { hungerStreak: { decrement: 1 } },
    }),
    prisma.character.updateMany({
      where: { id: { in: toStarve.map((character) => character.id) } },
      data: { hungerStreak: { increment: 1 } },
    }),
    ...(newlyDyingIds.length && dyingId
      ? [
          prisma.characterTag.createMany({
            data: newlyDyingIds.map((characterId) => ({
              characterId,
              tagId: dyingId,
              source: "EVENT",
              // One-turn clock: granted at close N, expires N + 1, then
              // db/lib/dyingDeathPass.js takes over.
              expiresTurn: turn.number + 1,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  // Starving to death's door is frightening (docs/systemdocs/MOOD.md). The
  // grant above is a batch createMany, so the dial moves here, after it lands;
  // the band DMs ride back beside the hunger notices rather than being sent.
  const moodDms = [];
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
    starved: toStarve.length,
    shielded: shieldedIds.length,
    skipped,
    recovering: stillHungryAfterEating.length,
    starvedCharacterIds: toStarve.map((character) => character.id),
    hungerNotices,
    moodDms,
    newlyDyingCharacterIds: newlyDyingIds,
  };
}

module.exports = {
  runHungerPass,
  hungerDm,
  DYING_DM,
  HUNGER_STREAK_CAP,
};
