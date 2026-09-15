-- Deadchat (db/lib/deadchat.js): the one room the dead talk in.
--
-- Two GameConfig columns, both provisioned rather than configured, matching the
-- radio net columns beside them: the category the channel sits in and the
-- channel itself. Null until db:sync-deadchat has run.
--
-- Additive and nullable — nothing is dropped and no existing row is rewritten,
-- so this applies cleanly under `migrate deploy` with the old code still
-- serving traffic.
--
-- The Ghost ROLE this replaces is not touched here. It is a Discord object, not
-- a column: it goes by hand once the code that re-creates it is gone.
ALTER TABLE "GameConfig" ADD COLUMN "deadchatCategoryId" TEXT;
ALTER TABLE "GameConfig" ADD COLUMN "deadchatChannelId" TEXT;
