-- Discord goes opt-in: a character now mirrors to Discord only when
-- `discordMirrored` is on, replacing the old opt-out `webOnly` flag.
-- `webOnly` / `webOnlyChangedAt` stay in the schema, unread, for a week.

ALTER TABLE "Character" ADD COLUMN "discordMirrored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Character" ADD COLUMN "discordMirroredChangedAt" TIMESTAMP(3);

UPDATE "Character"
SET "discordMirrored" = NOT "webOnly",
    "discordMirroredChangedAt" = "webOnlyChangedAt";
