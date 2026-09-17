-- Pickpocket (docs/systemdocs/THEFT.md §2): going through a standing person's
-- pockets. One row per thief per target per turn, doing two jobs.
--
-- It is the RATION. The unique index IS the rule — the insert is the claim,
-- the SearchAttempt/InterceptHit discipline, because a count-then-create over
-- AuditLog rows is not race-proof and this ration has no cooldown standing
-- behind it. It also has to survive a failed roll, or failing would be a free
-- retry, which a pending-row query could not manage.
--
-- And it is the AUTHORIZATION for the second half. Pickpocket is two acts —
-- roll, then pick what to take — and the take re-reads this row for whether it
-- may happen at all and how many pounds are left. die/outcome/budgetLbs are
-- columns rather than something handed to the browser because an authorization
-- that travelled through a client is not one.
--
-- turnId is deliberately NOT a foreign key: it is a claim token, and deleting
-- a turn must not cascade into a spent ration. It is also what expires the
-- authorization for free, since the take looks the row up by the currently
-- open turn.
--
-- Additive only. No existing row or column is touched.

CREATE TABLE "PickpocketAttempt" (
    "id" TEXT NOT NULL,
    "thiefId" TEXT NOT NULL,
    "targetCharacterId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "die" INTEGER NOT NULL,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "budgetLbs" DOUBLE PRECISION NOT NULL,
    "spentLbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickpocketAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickpocketAttempt_thiefId_targetCharacterId_turnId_key" ON "PickpocketAttempt"("thiefId", "targetCharacterId", "turnId");
CREATE INDEX "PickpocketAttempt_targetCharacterId_idx" ON "PickpocketAttempt"("targetCharacterId");

ALTER TABLE "PickpocketAttempt" ADD CONSTRAINT "PickpocketAttempt_thiefId_fkey" FOREIGN KEY ("thiefId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickpocketAttempt" ADD CONSTRAINT "PickpocketAttempt_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
