-- AlterTable: Site.configLocked — when true, the analyzer must not overwrite a
-- built config (fixes the analyzer race, LRN-RACE-1/2). Set on every PUT /config,
-- cleared on a deliberate transition to ANALYZING (re-analyze).
ALTER TABLE "Site" ADD COLUMN "configLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: ScrapeRun.warnings — structured, non-blocking completion-quality
-- signals (job-count drop vs previous run, near-timeout, dead detail pages).
ALTER TABLE "ScrapeRun" ADD COLUMN "warnings" JSONB;

-- Backfill: protect the existing fleet immediately. Any ACTIVE/REVIEW site that
-- already carries a built config (non-null fieldMappings) is locked so a later
-- analyzer run cannot clobber it. ANALYZING sites are intentionally left unlocked
-- so their in-flight first analysis can still write its result.
UPDATE "Site"
SET "configLocked" = true
WHERE "status" IN ('ACTIVE', 'REVIEW')
  AND "fieldMappings" IS NOT NULL;
