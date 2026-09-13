-- A letter's title now survives the seal, so it needs somewhere to live that
-- is not Tag.name — which sealing overwrites in place.
ALTER TABLE "Tag" ADD COLUMN "paperTitle" TEXT;
