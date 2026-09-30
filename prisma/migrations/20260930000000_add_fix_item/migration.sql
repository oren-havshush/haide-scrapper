-- addsite2 phase two, step 1a: the fix queue and the cohort tag.
--
-- FixItem records what a site needed fixing after it went ACTIVE: logged by an
-- operator (MANUAL) or, from step 2, opened by a nightly value check (CHECK).
-- src/lib/fixScore.ts scores each site on these in the 14 days after activeAt,
-- and compares the frozen-addsite2 control cohort with addsite3.
--
-- Site.onboardingSkill tags the cohort. Set at creation by addsite3 only;
-- NULL means addsite2 or older, which is true of every existing row.
--
-- Additive only: a new table, two new enums, one nullable column. No backfill.
-- Not a SweepCounters key, so the counters spread in closeSweep is unaffected.

-- CreateEnum
CREATE TYPE "FixField" AS ENUM ('JOB_ID', 'APPLY', 'TITLE', 'DESCRIPTION', 'DATE', 'LOCATION', 'COVERAGE', 'COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "FixSource" AS ENUM ('MANUAL', 'CHECK');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "onboardingSkill" TEXT;

-- CreateTable
CREATE TABLE "FixItem" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "field" "FixField" NOT NULL,
    "source" "FixSource" NOT NULL,
    "code" TEXT NOT NULL,
    "detail" TEXT,
    "jobIds" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" "FixSource",
    "minutes" INTEGER,
    "operator" TEXT,
    "note" TEXT,

    CONSTRAINT "FixItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixItem_siteId_resolvedAt_idx" ON "FixItem"("siteId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "FixItem" ADD CONSTRAINT "FixItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
