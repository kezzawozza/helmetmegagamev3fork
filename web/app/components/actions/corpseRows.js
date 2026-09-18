// A corpse row (db/lib/corpses.js#corpsesInReach) as the dialogs pick it.
//
// A body is identified by its tag AND where it lies: the same Nekker Corpse
// row can be in two rooms, and "that one" has to mean one of them.
export function corpseIdOf(corpse) {
  return `${corpse.tagId}@${corpse.sourceKey}`;
}

export function corpseLabel(corpse) {
  return `${corpse.tagName} — ${corpse.source.name}`;
}

// Display names for every yield the Butcher verb can produce — the four
// corpse ones, plus livestock's meat and fat (ARELITZ.md §5) — kept here
// rather than fetched: the dialog needs a word, not a catalog row.
const YIELD_NAMES = {
  "nekker-pheromones": "Nekker Pheromones",
  "graga-sac": "a Graga Sac",
  "skinless-brain": "a Skinless Brain",
  "human-flesh": "Human Flesh",
  meat: "Meat",
  "rendered-fat": "Fat",
};

// `corpse.yields` is `[{ slug, quantity }, ...]` — one entry for an ordinary
// corpse, two (meat + fat) for livestock.
export function yieldLabel(corpse) {
  const parts = (corpse.yields ?? []).map(({ slug, quantity }) => {
    const name = YIELD_NAMES[slug] ?? "something";
    return quantity > 1 ? `${quantity} ${name}` : name;
  });
  if (!parts.length) return "something";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
