-- Site.companyOperatorFields (owner, 2026-10-09): the company profile columns
-- the operator set by hand in the dashboard's edit dialog, so a recapture
-- keeps them (src/lib/operatorFields.ts).
--
-- Additive only, with an empty default; no backfill here.

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "companyOperatorFields" TEXT[] NOT NULL DEFAULT '{}';
