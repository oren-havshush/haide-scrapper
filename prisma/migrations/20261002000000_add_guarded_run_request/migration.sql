-- addsite2 phase two, step 3, option B: guarded single-site runs requested
-- through the API by operators without ssh.
--
-- POST /api/sites/[id]/guarded-run writes a PENDING row; the claim timer on the
-- box (deploy/systemd/haide-sweep-claim.*) claims one at a time and runs the
-- existing single-site driver, recording the sweep it ran and the result.
--
-- Additive only: one new table. No backfill, no change to any existing row.

-- CreateTable
CREATE TABLE "GuardedRunRequest" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operator" TEXT,
    "tokenHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "sweepId" TEXT,
    "result" JSONB,

    CONSTRAINT "GuardedRunRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardedRunRequest_status_requestedAt_idx" ON "GuardedRunRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "GuardedRunRequest_siteId_idx" ON "GuardedRunRequest"("siteId");

-- AddForeignKey
ALTER TABLE "GuardedRunRequest" ADD CONSTRAINT "GuardedRunRequest_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
