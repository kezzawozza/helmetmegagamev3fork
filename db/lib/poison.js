// Poisoning + resistance (the medical pass, M4). Pure, Prisma-free, required
// by both db/lib/tagWrites.js and the web app's server actions.
//
// Secrecy note: nothing here ever returns raw poisonedCount/poisonPayload
// unfiltered — only a COUNT drawn or a yes/no on detection. What a client
// may see is decided at the serialization boundary (character/page.js,
// db/lib/examine.js), not here.

// Two ways a character can tell a stack is tainted: the trait (`poison-sense`)
// or the held gadget (`poison-snooper`, never consumed). Either is enough.
const POISON_SENSE_SLUG = "poison-sense";
const POISON_SNOOPER_SLUG = "poison-snooper";

// `{ tag: { slug } }` shape (db/lib/incapacitation.js#slugSet convention),
// tolerant of a bare Tag[] too.
function canDetectPoison(characterTags) {
  return (characterTags ?? []).some((ct) => {
    const slug = ct?.tag?.slug ?? ct?.slug;
    return slug === POISON_SENSE_SLUG || slug === POISON_SNOOPER_SLUG;
  });
}

// A hypergeometric draw: out of `total` units where `poisoned` carry the
// taint, how many of the `take` units LEAVING are poisoned. Serves both a
// single Consume draw and a Transfer/Loot move of many units at once,
// drawing without replacement so the split matches the stack's own ratio.
function drawPoisonedUnits(total, poisoned, take) {
  let remainingTotal = Math.max(0, Math.trunc(total ?? 0));
  let remainingPoisoned = Math.max(0, Math.min(Math.trunc(poisoned ?? 0), remainingTotal));
  let drawn = 0;
  const draws = Math.max(0, Math.trunc(take ?? 0));
  for (let i = 0; i < draws && remainingTotal > 0; i += 1) {
    if (Math.random() * remainingTotal < remainingPoisoned) {
      drawn += 1;
      remainingPoisoned -= 1;
    }
    remainingTotal -= 1;
  }
  return drawn;
}

module.exports = { POISON_SENSE_SLUG, POISON_SNOOPER_SLUG, canDetectPoison, drawPoisonedUnits };
