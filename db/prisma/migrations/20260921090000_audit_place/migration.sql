-- AuditLog gains WHERE it happened, for /gm/audit's room/location filter.
-- Additive, nullable, no backfill: forward-only, every existing row stays
-- NULL. SetNull on delete, never Cascade -- a zone re-sync that prunes a
-- Room must not take its audit history with it.
ALTER TABLE "AuditLog" ADD COLUMN "locationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "roomId" TEXT;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Each leads its own composite so a room filter with no location picked
-- still hits an index, and both still serve the createdAt sort/count that
-- sits beside every filtered query on /gm/audit.
CREATE INDEX "AuditLog_locationId_createdAt_idx" ON "AuditLog"("locationId", "createdAt");
CREATE INDEX "AuditLog_roomId_createdAt_idx" ON "AuditLog"("roomId", "createdAt");
