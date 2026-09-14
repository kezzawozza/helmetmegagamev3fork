-- The per-turn fog of war on the Location channels (db/lib/vantages.js).
--
-- A row is a Location a character walked into this turn and is no longer
-- standing in. Where they stand stays Character.locationId, so nothing here
-- duplicates it.
--
-- Additive: one new table, nothing dropped, nothing rewritten. zoneId and
-- turnId are snapshot columns with no foreign key on purpose — they are read
-- as a validity filter, and a Turn or Zone going away should leave a dark row
-- behind, not cascade.
CREATE TABLE "Vantage" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "litAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vantage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vantage_characterId_locationId_key" ON "Vantage"("characterId", "locationId");
CREATE INDEX "Vantage_characterId_turnId_idx" ON "Vantage"("characterId", "turnId");
CREATE INDEX "Vantage_locationId_idx" ON "Vantage"("locationId");

ALTER TABLE "Vantage" ADD CONSTRAINT "Vantage_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vantage" ADD CONSTRAINT "Vantage_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
