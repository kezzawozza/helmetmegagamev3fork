-- Tag.removesOnConsume: plain slugs to strip off the consumer when this item
-- is consumed. Additive, nullable, no backfill needed.
ALTER TABLE "Tag" ADD COLUMN "removesOnConsume" JSONB;
