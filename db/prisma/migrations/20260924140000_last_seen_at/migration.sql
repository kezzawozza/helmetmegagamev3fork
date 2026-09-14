-- The "online" badge's clock (db/lib/whosHere.js, HereList/GmHereList).
--
-- Additive: one nullable column, nothing dropped, nothing rewritten. NULL is
-- the right value for everybody until the first touch — read as offline,
-- never as "just now."
ALTER TABLE "Character" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
