-- Tag.category holds the DISPLAY NAME from docs/tags.yaml's `categories:` map
-- ("Items"), which is what db/lib/syncTags.js writes for every catalog row.
-- Six runtime minters write their own rows instead of going through the sync,
-- and five of them wrote the YAML SLUG ("items") by mistake: paper and books
-- (paperMint.js), corpses (corpseMint.js), photographs (photoMint.js), pointer
-- devices (pointerMint.js), player-packed crates (character/actions/misc.js)
-- and Depot crates (depotCrates.js). Only headstone.js had it right.
--
-- The split was never only cosmetic. web/app/(app)/chat/thingRows.js buckets
-- the Things drawer by matching this string EXACTLY against ["Items","Assets"],
-- so every row above was missing from that drawer outright — a player could not
-- see, transfer or destroy a note they had written themselves, and its weight
-- was absent from the drawer's total. The GM tag pickers, which build their
-- category tabs from `SELECT DISTINCT category`, grew a second "items" tab.
--
-- The minters now all spell it TAG_CATEGORY.ITEMS (db/lib/constants.js). This
-- is the backfill for rows already written. Data-only and idempotent: it
-- touches no schema, and re-running it matches nothing.

UPDATE "Tag" SET "category" = 'Items' WHERE "category" = 'items';
