-- addsite2 phase two, step 1c: fix items opened by the API writes themselves.
--
-- FixItem gains what an automatic item needs: whether its minutes are the
-- estimate (minutesEstimated), the sha256 prefix of the token whose write
-- opened it (never the token), and its latest write, for the one-hour
-- extension (src/lib/autoFix.ts).
--
-- SiteApiCall records each API call on a site, so the estimate can run from a
-- token's first call that day to its latest write. Pruned to seven days on
-- every write.
--
-- Additive only: three columns with safe defaults or NULL, one new table.

-- AlterTable
ALTER TABLE "FixItem" ADD COLUMN     "lastWriteAt" TIMESTAMP(3),
ADD COLUMN     "minutesEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tokenHash" TEXT;

-- CreateTable
CREATE TABLE "SiteApiCall" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteApiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteApiCall_siteId_tokenHash_at_idx" ON "SiteApiCall"("siteId", "tokenHash", "at");

-- AddForeignKey
ALTER TABLE "SiteApiCall" ADD CONSTRAINT "SiteApiCall_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
