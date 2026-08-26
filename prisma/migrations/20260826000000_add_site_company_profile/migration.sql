-- AlterTable
--
-- Additive only: eight nullable columns on "Site". No existing column is
-- altered, no NOT NULL, no DEFAULT, no new enum type, no new index, no new
-- table. In PostgreSQL 11+ a nullable ADD COLUMN is metadata-only -- no table
-- rewrite, no lock beyond a brief catalog update.
--
-- The public jobs site reads this database directly, so this change must stay
-- invisible to every query it currently issues. "companyProfileStatus" is TEXT
-- rather than an enum on purpose: an unrecognised enum variant throws in a
-- consumer's Prisma client, and PostgreSQL enum values can never be removed.
--
-- Rollback (do not automate; run by hand if the feature is reverted):
--   ALTER TABLE "Site"
--     DROP COLUMN "companyHomepageUrl",   DROP COLUMN "companyAbout",
--     DROP COLUMN "companyLogoPath",      DROP COLUMN "companyLogoSourceUrl",
--     DROP COLUMN "companyHqAddress",     DROP COLUMN "companyHqCity",
--     DROP COLUMN "companyProfileStatus", DROP COLUMN "companyProfileAt";
ALTER TABLE "Site" ADD COLUMN "companyHomepageUrl" TEXT;
ALTER TABLE "Site" ADD COLUMN "companyAbout" TEXT;
ALTER TABLE "Site" ADD COLUMN "companyLogoPath" TEXT;
ALTER TABLE "Site" ADD COLUMN "companyLogoSourceUrl" TEXT;
ALTER TABLE "Site" ADD COLUMN "companyHqAddress" TEXT;
ALTER TABLE "Site" ADD COLUMN "companyHqCity" TEXT;
ALTER TABLE "Site" ADD COLUMN "companyProfileStatus" TEXT;
ALTER TABLE "Site" ADD COLUMN "companyProfileAt" TIMESTAMP(3);
