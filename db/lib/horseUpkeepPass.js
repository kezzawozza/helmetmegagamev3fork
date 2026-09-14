// The upkeep for every animal on the horse's family tree: 1 ⬢ per turn, per species, from everyone
// holding one — run from db/index.js#resolveNeeds() so the bot's cron and the Dev Panel's "End turn"
// button behave identically (TURN-ENGINE.md). Takes `prisma` as a parameter — see db/lib/dm.js for why.
// Three rules, each the opposite of what the rest of the horse does: HELD, not equipped, so stowing an
// animal doesn't skip the bill; can't pay means nothing happens (no starving marker, no runaway); and
// each species bills SEPARATELY — a Horse plus an Arelitz Warbeast pays 2 ⬢, not 1.
const { HORSE_SLUG, HORSE_UPKEEP_COST, UPKEEP_SLUGS } = require("./constants");

async function runHorseUpkeepPass(prisma, turn) {
  const tags = await prisma.tag.findMany({
    where: { slug: { in: UPKEEP_SLUGS } },
    select: { id: true, slug: true },
  });
  if (!tags.length) {
    console.error(`Horse upkeep skipped: no "${HORSE_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }

  // The floor is structural: the where-guard matches its own decrement, so resources can never go negative.
  let fed = 0;
  for (const tag of tags) {
    const { count } = await prisma.character.updateMany({
      where: {
        status: "ALIVE",
        resources: { gte: HORSE_UPKEEP_COST },
        tags: { some: { tagId: tag.id } },
      },
      data: { resources: { decrement: HORSE_UPKEEP_COST } },
    });
    fed += count;
  }

  return { turnNumber: turn.number, fed };
}

module.exports = { runHorseUpkeepPass };
