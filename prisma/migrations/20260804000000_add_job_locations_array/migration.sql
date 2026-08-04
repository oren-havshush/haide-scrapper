-- Multi-location support.
--
-- ADDITIVE ONLY. "location" is deliberately left in place and keeps holding the
-- primary value, because the public site reads this database directly — changing
-- that column's type would break it. New readers use "locations"; old readers
-- keep working untouched.
--
-- ~15% of jobs name more than one place ("חולון ובת-ים, ת\"א, מודיעין"), which a
-- single string cannot represent.

ALTER TABLE "Job" ADD COLUMN "locations" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "JobLocationOverride" ADD COLUMN "locations" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from the existing single value so no row is left with an empty array
-- where a location is known. Jobs whose location is the "Unknown" placeholder
-- stay empty — that placeholder is not a location.
UPDATE "Job"
   SET "locations" = ARRAY["location"]
 WHERE "location" IS NOT NULL
   AND "location" <> ''
   AND "location" <> 'Unknown'
   AND cardinality("locations") = 0;

UPDATE "JobLocationOverride"
   SET "locations" = ARRAY["location"]
 WHERE "location" IS NOT NULL
   AND "location" <> ''
   AND cardinality("locations") = 0;

-- Supports "jobs in city X" queries against the array.
CREATE INDEX "Job_locations_idx" ON "Job" USING GIN ("locations");
