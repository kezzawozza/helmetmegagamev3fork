-- The point-buy budget drops from 12 to 8. A thinner sheet at creation: fewer
-- points to spend means a character is two or three choices, not a catalogue.
-- The live row moves with the default only if it is still sitting on 12, so a
-- GM who already tuned it from the Dev Panel keeps their number.
ALTER TABLE "GameConfig" ALTER COLUMN "startingTagPoints" SET DEFAULT 8;
UPDATE "GameConfig" SET "startingTagPoints" = 8 WHERE "startingTagPoints" = 12;
