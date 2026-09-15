-- Marks the Moves a player wrote themselves, which is what makes a Gambit
-- editable and withdrawable until lock-in. Defaults false so every row the
-- GAME filed -- auto-Routines, the labor pass, travel stubs, Research, the
-- forge's Trinket, an above-skill heal -- fails closed and stays final.
ALTER TABLE "Action" ADD COLUMN "playerFiled" BOOLEAN NOT NULL DEFAULT false;
