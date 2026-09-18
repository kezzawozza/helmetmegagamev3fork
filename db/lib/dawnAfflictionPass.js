// Dawn afflictions (docs/systemdocs/TAGS.md): Guilt Ridden and Insomniac each
// carry a nightly chance of a bad night's sleep, stepped through the same
// Tired -> Exhausted ladder a day's mining uses (db/lib/fatigue.js) — a
// first bad night lands on Tired, a second one running (or one on top of a
// day's Labor) escalates to Exhausted. Run from db/index.js#resolveNeeds()
// right after the hunger pass. Takes `prisma` as a parameter — see
// db/lib/dm.js.
const { TIRED_SLUG, EXHAUSTED_SLUG, GUILT_RIDDEN_SLUG, INSOMNIAC_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");
const { nextFatigueSlug } = require("./fatigue");
const { alivePassCharacters } = require("./aliveCharacters");

const GUILT_RIDDEN_ODDS = 0.05;
const INSOMNIAC_ODDS = 0.2;

async function runDawnAfflictionPass(prisma, turn, { rng = Math.random } = {}) {
  const [tiredTag, exhaustedTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: TIRED_SLUG }, select: { id: true, defaultDurationTurns: true } }),
    prisma.tag.findUnique({ where: { slug: EXHAUSTED_SLUG }, select: { id: true, defaultDurationTurns: true } }),
  ]);
  const tagBySlug = { [TIRED_SLUG]: tiredTag, [EXHAUSTED_SLUG]: exhaustedTag };
  if (!tiredTag || !exhaustedTag) {
    const missingSlug = !tiredTag ? TIRED_SLUG : EXHAUSTED_SLUG;
    console.error(`runDawnAfflictionPass: no "${missingSlug}" tag — run npm run db:sync-tags. Dawn afflictions won't bite.`);
    return { turnNumber: turn.number, rolled: 0, granted: 0, notices: [] };
  }

  const characters = await alivePassCharacters(prisma, {
    where: {
      tags: { some: { tag: { slug: { in: [GUILT_RIDDEN_SLUG, INSOMNIAC_SLUG] } } } },
    },
    select: {
      id: true,
      discordUserId: true,
      name: true,
      tags: {
        where: { tag: { slug: { in: [GUILT_RIDDEN_SLUG, INSOMNIAC_SLUG, TIRED_SLUG, EXHAUSTED_SLUG] } } },
        select: { id: true, tag: { select: { slug: true } } },
      },
    },
  });

  let rolled = 0;
  let granted = 0;
  const notices = [];

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tag.slug));
    let hit = false;
    if (held.has(GUILT_RIDDEN_SLUG)) {
      rolled += 1;
      if (rng() < GUILT_RIDDEN_ODDS) hit = true;
    }
    if (held.has(INSOMNIAC_SLUG)) {
      rolled += 1;
      if (rng() < INSOMNIAC_ODDS) hit = true;
    }
    if (!hit) continue;

    const targetSlug = nextFatigueSlug(held);
    if (!targetSlug) continue; // already Exhausted — a bad night can't make that worse

    const tag = tagBySlug[targetSlug];
    const expiresTurn = expiryFrom(turn.number + 1, tag.defaultDurationTurns ?? 1);
    const tiredRow = targetSlug === EXHAUSTED_SLUG
      ? character.tags.find((ct) => ct.tag.slug === TIRED_SLUG)
      : null;

    const result = await prisma
      .$transaction(async (tx) => {
        // Escalating: consume the Tired row rather than leaving it to expire
        // alongside the new Exhausted, the same reasoning as the Labor payout
        // in db/lib/moveEffects.js.
        if (tiredRow) await tx.characterTag.delete({ where: { id: tiredRow.id } });
        return tx.characterTag.createMany({
          data: [{ characterId: character.id, tagId: tag.id, source: "EVENT", quantity: 1, expiresTurn }],
          skipDuplicates: true,
        });
      })
      .catch((err) => {
        console.error(`runDawnAfflictionPass: ${targetSlug} grant failed for ${character.id}:`, err.message ?? err);
        return null;
      });
    if (!result || result.count === 0) continue;

    granted += 1;
    if (character.discordUserId) {
      notices.push({
        discordUserId: character.discordUserId,
        content: targetSlug === EXHAUSTED_SLUG
          ? "You barely slept again. You're **Exhausted**."
          : "You barely slept. You wake **Tired**.",
      });
    }
  }

  return { turnNumber: turn.number, rolled, granted, notices };
}

module.exports = { runDawnAfflictionPass };
