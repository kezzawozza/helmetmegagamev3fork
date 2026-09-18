-- Ambrosia: a pill you swallow to be better at something.
--
-- Nothing in the game hands out tag points outside a fulfilled Desire, so
-- there was no field to author this with. This is the twin of
-- consumesIntoResources, which is the same idea for material, and it rides the
-- same consume path.

ALTER TABLE "Tag" ADD COLUMN "consumesIntoTagPoints" INTEGER;
