-- Recipe and cure costs become decimals.
--
-- `Tag.requirementTurns` was an Int, and a fractional cost was authored as
-- `turnsCost: 1/N` in docs/tags.yaml and folded into TWO columns: 1 here, with
-- N in `requirementPerTurn` as its denominator. That overload is why a wound's
-- severity was readable off its price, and why the mood dial moved whenever
-- somebody repriced a cure.
--
-- Work is a decimal number of Moves now, in quarters: 0 Dead Simple, 0.25 /
-- 0.5 / 0.75 shares of a Routine, 1 the whole of it, 2+ a project.
-- `requirementPerTurn` goes back to meaning only what it says — a daily ration
-- on a Dead Simple recipe.

ALTER TABLE "Tag" ALTER COLUMN "requirementTurns" TYPE DOUBLE PRECISION;

-- Which rung of the cure ladder a wound sits on, authored rather than inferred
-- (docs/systemdocs/TAGS.md §5c). Half rungs exist, hence the float.
ALTER TABLE "Tag" ADD COLUMN "cureRung" DOUBLE PRECISION;

-- Decode any row still carrying the old two-column encoding. `npm run
-- db:sync-tags` rewrites everything the catalog names, so this is only for the
-- rows it will not touch: tags a GM authored through the Dev Panel, and the
-- runtime clones paperMint makes off a recipe.
--
-- Written out case by case rather than as `1.0 / "requirementPerTurn"` on
-- purpose. A third decodes to 0.333…, which is not a quarter and would be
-- refused if it were ever re-authored — so a third lands where the catalog
-- conversion puts it, on 0.25, and the arithmetic stays exact.
UPDATE "Tag" SET "requirementTurns" = 0.5,  "requirementPerTurn" = NULL WHERE "requirementTurns" = 1 AND "requirementPerTurn" = 2;
UPDATE "Tag" SET "requirementTurns" = 0.25, "requirementPerTurn" = NULL WHERE "requirementTurns" = 1 AND "requirementPerTurn" = 3;
UPDATE "Tag" SET "requirementTurns" = 0.25, "requirementPerTurn" = NULL WHERE "requirementTurns" = 1 AND "requirementPerTurn" = 4;
-- Anything else that still pairs a 1-turn cost with a denominator is not a
-- shape the catalog ever wrote. Clear the denominator so it cannot be read as a
-- ration on a Move-costing recipe, and leave the cost at a whole Move.
UPDATE "Tag" SET "requirementPerTurn" = NULL WHERE "requirementTurns" = 1 AND "requirementPerTurn" > 1;
