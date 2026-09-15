-- MIRROR joins the SystemReportKind enum: every db/lib/discordMirror run lands
-- as a SystemReport row, the way every channel doctor run does.
--
-- Alone in its own migration on purpose. Postgres will not let a value added by
-- ALTER TYPE ... ADD VALUE be USED by another statement in the same
-- transaction, and Prisma runs one migration.sql per transaction. Keeping the
-- enum change by itself means every later migration can reference 'MIRROR'.
ALTER TYPE "SystemReportKind" ADD VALUE 'MIRROR';
