-- Splits the Oracle's run into two phases (docs/systemdocs/ORACLE.md §2).
-- Phase one drafts everything already knowable five minutes before the Move
-- cutoff; phase two appends "Declared this turn" / "Needs a ruling" at the
-- cutoff itself, once the Moves are in.
--
-- phaseOneBody is kept apart from body so a phase-two retry appends to the
-- draft rather than to its own previous output. phaseTwoAt is what
-- isComplete() now asks for on a ZONE/THREATS row: a row existing is no
-- longer proof the page is finished, since phase one alone leaves one behind.
-- The FRONT row is written once, by the editor, after every ZONE/THREATS row
-- carries phaseTwoAt, and is stamped there too.
--
-- Additive only. Existing rows keep their body untouched.
ALTER TABLE "OracleSynopsis" ADD COLUMN "phaseOneBody" TEXT;
ALTER TABLE "OracleSynopsis" ADD COLUMN "phaseTwoAt" TIMESTAMP(3);

-- Pages written before two-phase existed are already complete: stamp them so
-- isComplete() does not decide every historical turn still needs a phase two.
UPDATE "OracleSynopsis" SET "phaseTwoAt" = "createdAt" WHERE "phaseTwoAt" IS NULL;

-- The phase-two append prompt, editable at /gm/dev?s=oracle like the other
-- two. NULL means "use the built-in default in db/lib/oraclePrompts.js".
ALTER TABLE "GameConfig" ADD COLUMN "oracleAppendPrompt" TEXT;

-- The shipped default for how many previous pages' PROSE a writer is shown
-- drops from 3 to 1 now that the open-threads list (structured memory) covers
-- most of what re-reading three whole pages was for. An existing row is a
-- value already written, not a default, so this does not touch it — an
-- install already running the Oracle keeps reading 3 until a GM changes it.
ALTER TABLE "GameConfig" ALTER COLUMN "oracleMemoryTurns" SET DEFAULT 1;
