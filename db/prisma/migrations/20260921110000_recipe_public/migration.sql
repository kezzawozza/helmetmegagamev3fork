-- Tag.recipePublic: an escape hatch from the ingredient-based Craft-menu
-- hiding in CRAFTING.md §2b. Miasma names `group: items-corpse`, a group
-- that always contains the three catalog:secret monster corpses, so the
-- gate never opens for a player who has never held a body -- wrong for a
-- basic Brewing recipe. Additive, defaults false, no backfill needed; set
-- true on miasma by the next db:sync-tags.
ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "recipePublic" BOOLEAN NOT NULL DEFAULT false;
