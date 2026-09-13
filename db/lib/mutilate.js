// Mutilate: taking one piece off a bound person or a corpse.
// docs/systemdocs/TORTURE.md §6 owns the design; this is the table behind it.
//
// Pure and PRISMA-FREE on purpose, the rule db/lib/corpses.js states at the
// top of its own file: the Mutilate dialog is a client component and needs
// MUTILATE_PARTS to build its menu, so anything prisma-shaped in here drags
// the @lifeweb/db barrel into the browser bundle and kills the route with a
// node:fs error. Off the barrel too — require it by path.

// One press, one piece. Each part is a LADDER: the first press grants the
// first rung, the second replaces it with the second, and there is no third
// because nobody has three eyes.
//
// `lethal` is a fact about the part rather than about the rung, because both
// lethal parts are one-rung ladders. A corpse ignores it — the subject is
// already dead and the tag is all that lands.
const MUTILATE_PARTS = Object.freeze([
  { key: "eye", label: "Eye", itemSlug: "eye", ladder: ["missing-eye", "blind"], lethal: false },
  { key: "tongue", label: "Tongue", itemSlug: "tongue", ladder: ["mute"], lethal: false },
  { key: "hand", label: "Hand", itemSlug: "hand", ladder: ["missing-fingers", "missing-arm"], lethal: false },
  { key: "foot", label: "Foot", itemSlug: "foot", ladder: ["missing-leg", "cripple"], lethal: false },
  { key: "stomach", label: "Stomach", itemSlug: "stomach", ladder: ["missing-stomach"], lethal: true },
  { key: "heart", label: "Heart", itemSlug: "heart", ladder: ["missing-heart"], lethal: true },
]);

function partFor(key) {
  return MUTILATE_PARTS.find((p) => p.key === key) ?? null;
}

// Which rung this press lands on, given what the subject already holds.
//
// Walked from the TOP down rather than the bottom up: a subject who somehow
// holds both rungs — Blind bought at creation on top of a Missing Eye a GM
// granted — is at the top of the ladder, and counting upward would read them
// as being on the first rung and take a third eye.
//
// Returns null when the ladder is spent, which the caller turns into a
// refusal. Never a partial result: an unknown part key is null too.
function resolveMutilation(partKey, subjectSlugs) {
  const part = partFor(partKey);
  if (!part) return null;
  const held = new Set(subjectSlugs ?? []);

  const top = part.ladder[part.ladder.length - 1];
  if (held.has(top)) return null;

  // The highest rung they hold, or -1 for an untouched subject.
  let at = -1;
  for (let i = part.ladder.length - 1; i >= 0; i -= 1) {
    if (held.has(part.ladder[i])) {
      at = i;
      break;
    }
  }
  const next = part.ladder[at + 1];
  if (!next) return null;

  return {
    part: part.key,
    label: part.label,
    grantSlug: next,
    // Only a replacement drops anything. The first rung adds and takes nothing.
    dropSlug: at >= 0 ? part.ladder[at] : null,
    itemSlug: part.itemSlug,
    lethal: part.lethal,
  };
}

// What Butcher hands over in one pass: every part run to the END of its
// ladder, skipping whatever's already been taken. Unlike resolveMutilation
// (one press, one rung) this returns however many rungs are left per part —
// e.g. an untouched eye is worth 2 Eyeballs (missing-eye, then blind), same
// as pressing Mutilate on it twice.
function harvestableOrgans(subjectSlugs) {
  const held = new Set(subjectSlugs ?? []);
  return MUTILATE_PARTS.map((part) => {
    let at = -1;
    for (let i = part.ladder.length - 1; i >= 0; i -= 1) {
      if (held.has(part.ladder[i])) {
        at = i;
        break;
      }
    }
    const quantity = part.ladder.length - (at + 1);
    if (quantity <= 0) return null;
    return {
      part: part.key,
      label: part.label,
      itemSlug: part.itemSlug,
      quantity,
      // Ladders replace rather than stack, so only the FINAL rung is ever
      // held at the end — however many presses it took to get there.
      grantSlug: part.ladder[part.ladder.length - 1],
      dropSlug: at >= 0 ? part.ladder[at] : null,
    };
  }).filter(Boolean);
}

module.exports = { MUTILATE_PARTS, partFor, resolveMutilation, harvestableOrgans };
