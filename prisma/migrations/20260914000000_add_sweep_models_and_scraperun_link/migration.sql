-- Sweep models, the WorkerJob -> ScrapeRun link, and one-active-job-per-site.
--
-- Additive. Nothing is dropped and no row is deleted.
--
-- ORDER IS LOAD-BEARING. The partial unique index at the end cannot be created
-- while duplicate active jobs exist, so the dedupe must run before it, and the
-- backfill before that. Until this migration ships alongside the deploy's
-- `set -euo pipefail` fix, a failing migration does not stop the deploy — so
-- this file has to be correct by construction rather than relying on the deploy
-- to catch it.

-- ---------------------------------------------------------------------------
-- 1. WorkerJob -> ScrapeRun link
-- ---------------------------------------------------------------------------

-- No FOREIGN KEY, deliberately. `clearSiteJobs` deletes a site's ScrapeRuns and
-- leaves its WorkerJobs, so dangling ids already exist on the box and will keep
-- being created. RESTRICT would break clearSiteJobs, CASCADE would delete worker
-- history, SET NULL would erase the link the reaper needs. The reaper joins and
-- finds nothing, which is the correct reading of "the run is gone".
ALTER TABLE "WorkerJob" ADD COLUMN "scrapeRunId" TEXT;

-- Backfill from the JSON payload, where the run still exists.
--
-- The EXISTS is the point. Today the link lives only in unindexed JSON
-- (siteService.ts), so without a backfill the reaper is blind to exactly the
-- orphans that exist now. But copying an id whose ScrapeRun was deleted would
-- assert that a run is there when it is not, and a wrong value is worse than a
-- missing one — NULL correctly means "no live run to close".
UPDATE "WorkerJob" w
SET "scrapeRunId" = w.payload->>'scrapeRunId'
WHERE w.payload ? 'scrapeRunId'
  AND w."scrapeRunId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "ScrapeRun" r WHERE r.id = w.payload->>'scrapeRunId'
  );

CREATE INDEX "WorkerJob_scrapeRunId_idx" ON "WorkerJob"("scrapeRunId");

-- The reaper's claim query reads active jobs oldest-first.
CREATE INDEX "WorkerJob_status_createdAt_idx" ON "WorkerJob"("status", "createdAt");

-- ---------------------------------------------------------------------------
-- 2. Dedupe active jobs — never delete
-- ---------------------------------------------------------------------------

-- Keep the newest active row per (siteId, type); mark every older one FAILED.
-- These rows are history: a deleted one takes with it the record that the job
-- was ever queued, which is the only trace of whatever queued it.
--
-- The (createdAt, id) tiebreaker matters. On ties in createdAt alone, a plain
-- `>` comparison marks BOTH rows superseded (each sees the other as newer) and
-- the unique index below then succeeds over an empty set — silently discarding
-- both jobs. Comparing id second makes the ordering total, so exactly one row
-- in each group survives.
DO $$
DECLARE
  superseded integer;
BEGIN
  UPDATE "WorkerJob" w
  SET status = 'FAILED',
      error = 'superseded: a newer active job exists for this site and type',
      "completedAt" = NOW()
  WHERE w.status IN ('PENDING', 'IN_PROGRESS')
    AND EXISTS (
      SELECT 1
      FROM "WorkerJob" n
      WHERE n."siteId" = w."siteId"
        AND n.type = w.type
        AND n.status IN ('PENDING', 'IN_PROGRESS')
        AND (n."createdAt", n.id) > (w."createdAt", w.id)
    );

  GET DIAGNOSTICS superseded = ROW_COUNT;
  RAISE NOTICE 'sweep migration: superseded % duplicate active WorkerJob row(s)', superseded;
END $$;

-- One active job per site and type. Raw SQL because Prisma cannot express a
-- partial unique index. This is what makes `createScrapeRun`'s in-progress
-- check a guarantee rather than a check-then-act race.
CREATE UNIQUE INDEX "worker_job_one_active_per_site_type"
  ON "WorkerJob" ("siteId", "type")
  WHERE status IN ('PENDING', 'IN_PROGRESS');

-- ---------------------------------------------------------------------------
-- 3. Sweep log
-- ---------------------------------------------------------------------------

-- kind / status / trigger are TEXT rather than enums, following
-- Site.companyProfileStatus: an unrecognised value can never throw in a
-- consumer's Prisma client, and a value stays removable without a migration.
CREATE TABLE "ScrapeSweep" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "silentDrift" INTEGER NOT NULL DEFAULT 0,
    "skippedConflict" INTEGER NOT NULL DEFAULT 0,
    "wouldHaveDemoted" INTEGER NOT NULL DEFAULT 0,
    "wouldHavePromoted" INTEGER NOT NULL DEFAULT 0,
    "listingsProtected" INTEGER NOT NULL DEFAULT 0,
    "haltedAt" TIMESTAMP(3),
    "haltReason" TEXT,
    "logText" TEXT,

    CONSTRAINT "ScrapeSweep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScrapeSweep_kind_startedAt_idx" ON "ScrapeSweep"("kind", "startedAt");
CREATE INDEX "ScrapeSweep_status_idx" ON "ScrapeSweep"("status");

-- siteId is NOT a foreign key, for the same reason as WorkerJob.scrapeRunId:
-- `deleteSite` would either fail or take the sweep history with it, and a
-- night's log should outlive the site it described.
CREATE TABLE "ScrapeSweepItem" (
    "id" TEXT NOT NULL,
    "sweepId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "scrapeRunId" TEXT,
    "outcome" TEXT NOT NULL,
    "failureCategory" TEXT,
    "jobsBefore" INTEGER NOT NULL DEFAULT 0,
    "jobsAfter" INTEGER NOT NULL DEFAULT 0,
    "newestJobAt" TIMESTAMP(3),
    "siteStatus" TEXT NOT NULL,
    "wouldDemoteTo" TEXT,
    "wouldPromoteTo" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScrapeSweepItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScrapeSweepItem_sweepId_siteId_phase_key"
  ON "ScrapeSweepItem"("sweepId", "siteId", "phase");
CREATE INDEX "ScrapeSweepItem_siteId_idx" ON "ScrapeSweepItem"("siteId");
CREATE INDEX "ScrapeSweepItem_sweepId_idx" ON "ScrapeSweepItem"("sweepId");

-- The one FK here is intentional: an item without its sweep is meaningless, and
-- deleting a sweep should take its rows.
ALTER TABLE "ScrapeSweepItem"
  ADD CONSTRAINT "ScrapeSweepItem_sweepId_fkey"
  FOREIGN KEY ("sweepId") REFERENCES "ScrapeSweep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
