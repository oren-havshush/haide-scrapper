-- The undersize guard refuses a scheduled run that extracts a fraction of a
-- site's listings (outcome "suspicious_drop"). Its item keeps jobsBefore and
-- jobsAfter as the site's real counts — nothing changed — so the refused count
-- needs a column of its own, or the item cannot say what was refused.
--
-- "warnings" copies the run's ScrapeRun.warnings onto the item, so a night's
-- rows carry the warnings its report surfaces.
--
-- Additive and nullable: no rewrite, no backfill. Existing items stay NULL,
-- which is true of them — neither value was recorded when they were written.

ALTER TABLE "ScrapeSweepItem"
  ADD COLUMN "scrapedCount" INTEGER,
  ADD COLUMN "warnings" JSONB;
