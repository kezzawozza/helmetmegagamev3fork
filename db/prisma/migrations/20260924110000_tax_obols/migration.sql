-- Taxing Obols, alongside Resources (FACTIONS.md, docs/tags.yaml's `taxman`
-- description). A PendingTax row is single-currency, so this only needs one
-- new column saying which stack `amount`/`paidAmount`/`appliedAmount` counts
-- against; every row filed before this defaults to the ⬢ it always meant.

DO $$ BEGIN
  CREATE TYPE "PendingTaxKind" AS ENUM ('RESOURCES', 'OBOL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "PendingTax" ADD COLUMN IF NOT EXISTS "kind" "PendingTaxKind" NOT NULL DEFAULT 'RESOURCES';
