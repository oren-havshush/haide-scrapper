-- The sweep hold, the rest of it (owner, 2026-10-13; design G2 with the
-- amendment): Cloudflare's weekday pause as a second hold value, who set a
-- hold, and the Saturday probe's last result.
--
-- Additive only: one enum value and three nullable columns; no backfill. A
-- NULL sweepHoldBy is read as "owner" (the three holds set by hand before it).

-- AlterEnum
ALTER TYPE "SweepHold" ADD VALUE 'CHALLENGE_RETRY_SATURDAY';

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "sweepHoldBy" TEXT,
ADD COLUMN "sweepHoldProbeAt" TIMESTAMP(3),
ADD COLUMN "sweepHoldProbeResult" TEXT;
