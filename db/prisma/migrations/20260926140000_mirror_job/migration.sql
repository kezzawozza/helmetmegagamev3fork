-- MirrorJob: the queue of places whose Discord side is out of date.
--
-- Purely additive — a new table, no column touched anywhere else — so it is
-- safe to apply ahead of the code that writes to it.
CREATE TABLE "MirrorJob" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "MirrorJob_pkey" PRIMARY KEY ("id")
);

-- Repeat saves of the same place coalesce into one job rather than piling up.
CREATE UNIQUE INDEX "MirrorJob_targetType_targetId_key" ON "MirrorJob"("targetType", "targetId");

CREATE INDEX "MirrorJob_finishedAt_idx" ON "MirrorJob"("finishedAt");
