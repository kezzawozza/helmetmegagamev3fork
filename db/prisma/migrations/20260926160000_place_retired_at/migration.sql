-- Soft-retire for places, authored from /gm/dev/zones. Additive and
-- nullable: existing rows default to live (NULL), nothing else changes.
ALTER TABLE "Zone" ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "Location" ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "retiredAt" TIMESTAMP(3);
