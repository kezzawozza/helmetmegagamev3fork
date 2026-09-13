-- Stage 1 of the GM Desires review queue (docs/systemdocs/DESIRES.md §6,
-- §10): a GM working the queue on /gm/turns needs to see why a player says
-- they earned the claim, and to be able to clear or reject it without a
-- second table.

-- AlterTable
ALTER TABLE "Desire" ADD COLUMN "reason" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedBy" TEXT;

-- AlterTable
ALTER TABLE "DesireTemplate" ADD COLUMN "verifyQuery" TEXT;
