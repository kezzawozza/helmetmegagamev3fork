// Shared "eating enough clears the band right now" clean-up for the 0-30
// hunger meter (db/lib/hunger.js). The doc's literal rule: when a character
// eats, the hungry/starving CharacterTag rows come off the instant the meter
// crosses back over their threshold, rather than waiting for the next turn
// close. Two callers need exactly this: the consume path
// (web/app/(app)/character/actions/misc.js#consumeTagRequestImpl) and the
// Dev Panel's Fed Them action
// (web/app/(app)/gm/dev/characters/[characterId]/actions.js#feedCharacter).
//
// db/lib/hungerPass.js's own turn-pass grant/drop logic is deliberately NOT
// rebuilt on top of this helper. That pass already batches every ALIVE
// character through one $transaction of createMany/deleteMany arrays (its
// own header calls this "the structural-clamp discipline" the old resource
// passes used) — recasting that bulk shape into N calls of this per-
// character helper would trade one transaction for hundreds with no
// behavior gain, so it keeps its own inline grant/drop lists instead. This
// module exists purely so the other two call sites don't each roll their
// own copy of the same two-line rule.
//
// Takes `tx` first, same convention as db/lib/tagWrites.js, so a caller can
// compose this into a larger transaction.
const { HUNGER_SLUG, STARVING_SLUG } = require("./constants");
const { HUNGRY_THRESHOLD, STARVING_THRESHOLD } = require("./hunger");
const { dropCharacterTag } = require("./tagWrites");

async function clearHungerBands(tx, characterId, hungerValue) {
  const tags = await tx.tag.findMany({
    where: { slug: { in: [HUNGER_SLUG, STARVING_SLUG] } },
    select: { id: true, slug: true },
  });
  const hungryTag = tags.find((t) => t.slug === HUNGER_SLUG);
  const starvingTag = tags.find((t) => t.slug === STARVING_SLUG);

  // dropCharacterTag is a no-op (returns early) when the row isn't held, so
  // this is safe to call unconditionally once the threshold clears.
  if (hungryTag && hungerValue > HUNGRY_THRESHOLD) {
    await dropCharacterTag(tx, characterId, hungryTag.id);
  }
  if (starvingTag && hungerValue > STARVING_THRESHOLD) {
    await dropCharacterTag(tx, characterId, starvingTag.id);
    await tx.character.update({
      where: { id: characterId },
      data: { starvingSinceTurn: null },
    });
  }
}

module.exports = { clearHungerBands };
