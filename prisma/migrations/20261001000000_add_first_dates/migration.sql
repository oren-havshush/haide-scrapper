-- Step A: the "first" dates.
--
-- Site.firstActiveAt  - the first move to ACTIVE, written once where NULL and
--                       never again (activeAt is rewritten by every later move,
--                       so the fix score's 14-day window is anchored here).
-- Site.firstScrapedAt - the first completed scrape that wrote jobs, written once.
-- Job.firstSeenAt     - carried from the previous row with the same identity on
--                       every scrape; a row from before this column takes the
--                       first night's date.
--
-- Additive and nullable only; the public site reads Job directly. No backfill
-- here: existing sites are filled afterwards from a list the owner reviewed,
-- by worker/tools/backfillFirstDates.ts, and only where the column is NULL.

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "firstActiveAt" TIMESTAMP(3),
ADD COLUMN     "firstScrapedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "firstSeenAt" TIMESTAMP(3);
