-- The two columns Search needs (docs/systemdocs/SEARCH.md).
--
-- Offer.hiddenTagIds: the tag ids the responder ticked on "Hide items",
-- written before they answer and read once by acceptSearch. SEARCH only, the
-- way Offer.teacherId is LESSON only. Defaults empty, so every existing offer
-- needs no backfill and never reads it.
--
-- InterceptWatch.autoSearch: raise a search offer against whoever this watch
-- catches. Defaults false, so no existing watch changes behaviour.

ALTER TABLE "Offer" ADD COLUMN "hiddenTagIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "InterceptWatch" ADD COLUMN "autoSearch" BOOLEAN NOT NULL DEFAULT false;

-- The once-a-turn ration. The unique index IS the rule — the insert is the
-- claim, the InterceptHit discipline (docs/systemdocs/INTERCEPT.md §5), because
-- a count-then-create over AuditLog rows is not race-proof and this ration has
-- no cooldown standing behind it. turnId is deliberately NOT a foreign key: it
-- is a claim token, and deleting a turn must not cascade into a spent ration.

CREATE TABLE "SearchAttempt" (
    "id" TEXT NOT NULL,
    "searcherId" TEXT NOT NULL,
    "targetCharacterId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchAttempt_searcherId_targetCharacterId_turnId_key" ON "SearchAttempt"("searcherId", "targetCharacterId", "turnId");
CREATE INDEX "SearchAttempt_targetCharacterId_idx" ON "SearchAttempt"("targetCharacterId");

ALTER TABLE "SearchAttempt" ADD CONSTRAINT "SearchAttempt_searcherId_fkey" FOREIGN KEY ("searcherId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SearchAttempt" ADD CONSTRAINT "SearchAttempt_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
