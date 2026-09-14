// Cooking (docs/systemdocs/COOKING.md): what a dish is made of and what that makes it do. A dish is
// a MINTED Tag row (mintCustomCraft) carrying `cookedFrom`; everything it does is derived from that
// list AT THE MOMENT SOMEBODY EATS IT, not baked in when cooked — so a later catalog edit (raw/cooked
// split, a medical-pass change, a tuned mood value) applies to every dish already made, no re-mint.
// Pure — no prisma, no React — so the Craft dialog and the server action share it (web/lib/customCraft.js).

// One ingredient's contribution, as consumesInto-shaped entries. NULL AND [] ARE DIFFERENT: null
// `into` means "use my own consumesInto", authored `[]` means "contribute nothing" (Blind Fish, Deep
// Morel — cooking removes their nausea).
function ingredientEntries(tag) {
  return tag?.cooked?.into ?? ownEntries(tag);
}

// A tag's own grants, zipped out of the four parallel columns.
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

// The dish and its ingredients, merged into ONE consumesInto-shaped tag for resolveConsumeGrants.
// One call, never one per ingredient — resolveConsumeGrants tracks what the character WILL hold
// across the list, so calling it twice would double-grant. `unlessTags` merges by union;
// `durationTurns` takes the LONGEST.
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

// What a dish CURES and leaves behind — `Tag.cures`/`Tag.curesInto`, unioned across ingredients.
// The rule: a cure rides through the pot only if the ingredient opts in with `cooked.cures: true`
// (a Burn Dressing or autoinjector goes ON somebody, not in the stew — db/lib/tagShapes.js#validateCooked
// refuses `cures: true` with `administerSkill`). The dish's own row never carries cures.
// `curesInto` merges last-wins on collision.
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

// Whether a dish reads as tainted to Poison Sense/Poison Snooper (db/lib/poison.js). Lacing a
// finished dish sets `poisonedCount`, but a cook putting something poisonous IN (nightshade) leaves
// no marker — so a dish is also tainted if any `cookedFrom` slug is flagged `poison: true`, read live
// off the catalog so a re-flag fixes every dish already made, no re-mint. Deliberately makes Phrygian
// Tears visible even though the taste line hides it — the tell costs a paid-for palate either way.

// The line the eater reads (NoticeProvider, bottom-right). A mark, if one ever belongs on this
// feature, goes HERE on the composed sentence, not on a taste fragment — one mark per message, at
// the very end, is the convention (CLAUDE.md). An empty taste is dropped rather than printed as a
// gap — that's Phrygian Tears and Adder's Bite, hidden with no tell.
export function tasteLine(tastes = []) {
  tastes = tastes.filter(Boolean);
  if (!tastes.length) return "You ate a meal.";
  if (tastes.length === 1) return `You ate a meal. It tastes like ${tastes[0]}.`;
  return `You ate a meal. It tastes like ${tastes.slice(0, -1).join(", ")} and ${tastes[tastes.length - 1]}.`;
}
