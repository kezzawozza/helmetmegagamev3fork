-- The d6 a character's Gambit rides on (docs/systemdocs/ADJUDICATION.md).
--
-- The die used to be thrown at the Move cutoff, three hours before the turn
-- closed, which meant a GM could not start adjudicating until then. It is
-- thrown at SUBMIT now. Players are told nothing until the turn closes, exactly
-- as before — only the desk sees it early.
--
-- Rolling at submit is what the cutoff design was built to avoid: it made Edit a
-- re-roll button you could flip Gambit -> Routine -> Gambit on all afternoon.
-- This row is the answer. The die is bound to the CHARACTER AND TURN, not to
-- the Move, and every later path reads it back instead of throwing again. That
-- matters most for withdraw, which DELETES the Action row outright
-- (db/lib/moveEconomy.js#deleteActionRestoringTurn) — a die kept on that row
-- would go with it, and re-filing would roll fresh.
--
-- The unique index IS the rule — the insert is the claim, the PickpocketAttempt
-- discipline, so two concurrent submits can neither double-roll nor double-spend
-- Inspired without an advisory lock anywhere.
--
-- turnId is deliberately NOT a foreign key, the same reasoning as
-- PickpocketAttempt.turnId: a claim token, and deleting a turn must not cascade
-- into a die somebody already paid Inspired for.
--
-- Additive only. No existing row or column is touched. A Move already confirmed
-- when this lands simply has no row here and no die; the cutoff pass still
-- throws one for it.

CREATE TABLE "GambitDie" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "die" INTEGER NOT NULL,
    "rolls" INTEGER[],
    "advantageSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GambitDie_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GambitDie_characterId_turnId_key" ON "GambitDie"("characterId", "turnId");
CREATE INDEX "GambitDie_turnId_idx" ON "GambitDie"("turnId");

ALTER TABLE "GambitDie" ADD CONSTRAINT "GambitDie_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
