-- A watch may now ignore anybody who was already in this zone (INTERCEPT.md).
-- Additive with a default, so every existing watch keeps catching everybody.
ALTER TABLE "InterceptWatch" ADD COLUMN "outsideZoneOnly" BOOLEAN NOT NULL DEFAULT false;
