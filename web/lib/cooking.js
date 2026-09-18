// Cooking (docs/systemdocs/COOKING.md): derived AT THE MOMENT SOMEBODY EATS IT, not baked in when
// cooked, so a later catalog edit applies to every dish already made, no re-mint.
function ingredientEntries(tag) {
  return tag?.cooked?.into ?? ownEntries(tag);
}

function ownEntries(tag) {
  const slugs = tag?.consumesInto ?? [];
  const oneOf = tag?.consumesIntoOneOf ?? null;
  const unless = tag?.consumesIntoUnless ?? null;
  const durations = tag?.consumesIntoDurations ?? null;
  return slugs.map((slug, i) => ({
    slug,
    oneOf: oneOf?.[i] ?? null,
    unlessTags: unless?.[slug] ?? [],
    durationTurns: durations?.[slug] ?? null,
  }));
}

// One call, never one per ingredient — resolveConsumeGrants tracks holdings across the list, twice would double-grant.
export function mergeDishGrants(mealTag, ingredientTags = []) {
  const entries = [...ownEntries(mealTag)];
  for (const ing of ingredientTags) entries.push(...ingredientEntries(ing));

  const consumesInto = [];
  const consumesIntoOneOf = [];
  const unless = {};
  const durations = {};
  let anyOneOf = false;
  for (const e of entries) {
    consumesInto.push(e.slug);
    consumesIntoOneOf.push(e.oneOf ?? null);
    if (e.oneOf) anyOneOf = true;
    if (e.unlessTags?.length) {
      unless[e.slug] = [...new Set([...(unless[e.slug] ?? []), ...e.unlessTags])];
    }
    if (e.durationTurns != null) {
      durations[e.slug] = Math.max(durations[e.slug] ?? 0, e.durationTurns);
    }
  }
  return {
    consumesInto,
    consumesIntoOneOf: anyOneOf ? consumesIntoOneOf : null,
    consumesIntoUnless: Object.keys(unless).length ? unless : null,
    consumesIntoDurations: Object.keys(durations).length ? durations : null,
    // A dish never pays out ⬢ — that's the Purse and the Supply Kit.
    consumesIntoResources: null,
  };
}

// The dish's own row never carries cures.
export function mergeDishCures(mealTag, ingredientTags = []) {
  const cures = new Set(mealTag?.cures ?? []);
  const curesInto = { ...(mealTag?.curesInto ?? {}) };
  for (const ing of ingredientTags) {
    if (!ing?.cooked?.cures) continue;
    for (const slug of ing.cures ?? []) cures.add(slug);
    Object.assign(curesInto, ing.curesInto ?? {});
  }
  return {
    cures: [...cures],
    curesInto: Object.keys(curesInto).length ? curesInto : null,
  };
}

// The line the eater reads (NoticeProvider, bottom-right). A mark, if one ever belongs on this
// feature, goes HERE on the composed sentence, not on a taste fragment — one mark per message, at
// the very end, is the convention (CLAUDE.md).
//
// `entries` is the meal's OWN taste first (Tag.mealTaste/mealTasteForm), then
// one per additional ingredient (cooked.taste/cooked.tasteForm) — COOKING.md
// §A1/§A6. Each entry is `{ taste, adjective }`; an empty taste is dropped
// rather than printed as a gap (that's what keeps Phrygian Tears and Adder's
// Bite undetectable even cooked into something), and `adjective: true`
// renders the fragment bare ("acidic") instead of the default noun form
// ("like onions") — web/lib/tagShapes.js#normalizeCooked's own tasteForm
// comment has the full rule. No fragments at all reads as "bland".
export function tasteLine(mealName, entries = []) {
  const fragments = entries
    .filter((e) => e && typeof e.taste === "string" && e.taste.trim())
    .map((e) => (e.adjective ? e.taste.trim() : `like ${e.taste.trim()}`));
  if (!fragments.length) return `You eat the ${mealName}, it tastes bland.`;
  if (fragments.length === 1) return `You eat the ${mealName}, it tastes ${fragments[0]}.`;
  return `You eat the ${mealName}, it tastes ${fragments.slice(0, -1).join(", ")} and ${fragments[fragments.length - 1]}.`;
}
