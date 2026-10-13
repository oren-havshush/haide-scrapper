-- Site.sweepHold (owner, 2026-10-13): a site blocked by a host bot challenge is
-- held out of the nightly and policy sweeps, never SKIPPED and never emptied.
-- It stays ACTIVE and visible; the hold says why and since when.
--
-- Additive only: three nullable columns and one enum; no backfill here.

-- CreateEnum
CREATE TYPE "SweepHold" AS ENUM ('HOST_CHALLENGE');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "sweepHold" "SweepHold",
ADD COLUMN "sweepHoldAt" TIMESTAMP(3),
ADD COLUMN "sweepHoldNote" TEXT;
