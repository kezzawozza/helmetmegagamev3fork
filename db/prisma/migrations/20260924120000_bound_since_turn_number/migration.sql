-- Break Restraints' turn-elapsed clock (docs/systemdocs/LESSONS.md §3c).
--
-- Additive: one nullable column, nothing dropped, nothing rewritten. NULL is
-- the right value for everybody — nobody has this claim until they're bound,
-- and the first bind stamps it (db/lib/bind.js#applyBind).
ALTER TABLE "Character" ADD COLUMN "boundSinceTurnNumber" INTEGER;
