-- Job.contentHash, for the public site (owner, 2026-10-08): SHA-256 hex of the
-- title and description, written by buildJobRows (worker/lib/contentHash.ts).
--
-- Additive and nullable only; the public site reads Job directly and treats
-- NULL as changed. No backfill: every row gets its value on its next scrape.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "contentHash" TEXT;
