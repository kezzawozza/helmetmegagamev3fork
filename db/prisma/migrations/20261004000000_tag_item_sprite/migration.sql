-- An item tag may carry its own art. `sprite` is a PNG basename under
-- web/public/assets/items/ -- pixel art from OpenSourceWeb, drawn by
-- web/app/components/TagIcon.js on chips, sheet rows, item cards and the
-- items table INSTEAD of the tag's TagGroup glyph.
--
-- Nullable with no default on purpose: null is the ordinary case and means
-- "draw the group icon", which is exactly what the whole catalog did before
-- this column existed. So the backfill for existing rows is nothing at all,
-- and the column is additive -- no deploy window where a surface renders
-- wrong.
--
-- docs/tags.yaml is the master (db/lib/syncTags.js copies it across and
-- refuses a value whose file is missing); db/lib/customCraftMint.js copies a
-- base recipe's value onto each custom mint.

ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "sprite" TEXT;
