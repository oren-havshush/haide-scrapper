-- CreateTable
CREATE TABLE "JobLocationOverride" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLocationOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobLocationOverride_siteId_jobKey_key" ON "JobLocationOverride"("siteId", "jobKey");

-- CreateIndex
CREATE INDEX "JobLocationOverride_siteId_idx" ON "JobLocationOverride"("siteId");

-- AddForeignKey
ALTER TABLE "JobLocationOverride" ADD CONSTRAINT "JobLocationOverride_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
