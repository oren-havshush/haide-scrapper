-- Incremental detail fetching (worker/lib/detailPlan.ts): a scheduled scrape
-- visits a job's detail page only when the job is new or its listing card
-- changed, and carries unchanged jobs' detail text forward; the Saturday 02:00
-- Asia/Jerusalem run fetches everything. These columns record which a run was
-- and how many pages it fetched versus carried, per run, per sweep item, and
-- per sweep.
--
-- All NULLABLE, deliberately unlike listingRefusals/noJobs. Every run before
-- this existed fetched every detail page, so a default of 0 would be a false
-- statement about every existing row. NULL means "not measured".
--
-- closeSweep spreads SweepCounters into the ScrapeSweep row, so the two sweep
-- columns must exist before the counters are deployed - the 2026-09-23 night
-- died on exactly that. scripts/sweepCountersSchema.test.ts pins it.

ALTER TABLE "ScrapeRun"
  ADD COLUMN "detailMode" TEXT,
  ADD COLUMN "detailsFetched" INTEGER,
  ADD COLUMN "detailsCarried" INTEGER;

ALTER TABLE "ScrapeSweepItem"
  ADD COLUMN "detailsFetched" INTEGER,
  ADD COLUMN "detailsCarried" INTEGER;

ALTER TABLE "ScrapeSweep"
  ADD COLUMN "detailsFetched" INTEGER,
  ADD COLUMN "detailsCarried" INTEGER;
