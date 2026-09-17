// The upkeep for every animal on the horse's family tree: 1 ⬢ per turn, per species, from everyone
// holding one — run from db/index.js#resolveNeeds() so the bot's cron and the Dev Panel's "End turn"
// button behave identically (TURN-ENGINE.md). Takes `prisma` as a parameter — see db/lib/dm.js for why.
// Three rules, each the opposite of what the rest of the horse does: HELD, not equipped, so stowing an
// animal doesn't skip the bill; can't pay means nothing happens (no starving marker, no runaway); and
// each species bills SEPARATELY — a Horse plus an Arelitz Warbeast pays 2 ⬢, not 1.
const { HORSE_SLUG, HORSE_UPKEEP_COST, UPKEEP_SLUGS } = require("./constants");
const { RESOURCES_SLUG, takeCharacterResources } = require("./resourceStack");

async function runHorseUpkeepPass(prisma, turn, { bornBefore } = {}) {
  const tags = await prisma.tag.findMany({
    where: { slug: { in: UPKEEP_SLUGS } },
    select: { id: true, slug: true },
  });
  if (!tags.length) {
    console.error(`Horse upkeep skipped: no "${HORSE_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }

  // The charge is a stack write per payer now, not one bulk updateMany — ⬢ live
  // in a CharacterTag row, so there is no column to decrement across a hundred
  // characters at once. takeCharacterResources is STRICT and conditional, which
  // is the same floor the old `gte` where-guard gave: the whole cost comes off
  // or nothing does, and nobody goes negative. The `some` clause below is only
  // a cheap pre-filter so the loop doesn't ask about people plainly unable to
  // pay; the real check is the write.
  let fed = 0;
  for (const tag of tags) {
    const holders = await prisma.character.findMany({
      where: {
        status: "ALIVE",
        AND: [
          { tags: { some: { tagId: tag.id } } },
          { tags: { some: { tag: { slug: RESOURCES_SLUG }, quantity: { gte: HORSE_UPKEEP_COST } } } },
        ],
        // Excludes a soul born mid-close (Metempsychosis, or any death this
        // same resolveNeeds() run reincarnated) — see db/index.js. They
        // haven't been alive for the turn that's closing, so the horse
        // hasn't been theirs to feed yet either.
        ...(bornBefore ? { createdAt: { lt: bornBefore } } : {}),
      },
      select: { id: true },
    });
    for (const holder of holders) {
      if (await takeCharacterResources(prisma, holder.id, HORSE_UPKEEP_COST)) fed += 1;
    }
  }

  return { turnNumber: turn.number, fed };
}

module.exports = { runHorseUpkeepPass };
