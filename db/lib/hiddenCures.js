// Consumables that quietly take something off the sheet — not the cure ladder (TAGS.md §5c), not
// Tag.removesInto, deliberately not in the catalog, so a player finds out by eating one and noticing.
// Keyed by the slug CONSUMED; value is what comes off. Ordinary consumesInto grants still apply first.
// Takes a tx as a parameter (db/lib/dm.js convention) and stays off the @lifeweb/db barrel.

const HIDDEN_CURES = {
  bliss: ["depressed"],
};

// Drops whatever the consumed slug cures. An Undo of the consume does NOT put the cured tag back — intentional.
async function applyHiddenCures(tx, characterId, consumedSlug) {
  const slugs = HIDDEN_CURES[consumedSlug];
  if (!slugs?.length) return [];

  const rows = await tx.characterTag.findMany({
    where: { characterId, tag: { slug: { in: slugs } } },
    select: { tagId: true, tag: { select: { slug: true } } },
  });
  for (const row of rows) await tx.characterTag.delete({ where: { characterId_tagId: { characterId, tagId: row.tagId } } });
  return rows.map((r) => r.tag.slug);
}

module.exports = { applyHiddenCures };
