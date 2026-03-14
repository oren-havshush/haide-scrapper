-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ANALYZING', 'REVIEW', 'ACTIVE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ScrapeRunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisMethod" AS ENUM ('PATTERN_MATCH', 'CRAWL_CLASSIFY', 'NETWORK_INTERCEPT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "WorkerJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkerJobType" AS ENUM ('ANALYSIS', 'SCRAPE');

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "status" "SiteStatus" NOT NULL DEFAULT 'ANALYZING',
    "confidenceScore" DOUBLE PRECISION,
    "fieldMappings" JSONB,
    "pageFlow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "analyzingAt" TIMESTAMP(3),
    "reviewAt" TIMESTAMP(3),
    "activeAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "salary" TEXT,
    "description" TEXT,
    "rawData" JSONB NOT NULL,
    "validationStatus" TEXT,
    "siteId" TEXT NOT NULL,
    "scrapeRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "ScrapeRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "jobCount" INTEGER NOT NULL DEFAULT 0,
    "totalJobs" INTEGER,
    "validJobs" INTEGER,
    "invalidJobs" INTEGER,
    "error" TEXT,
    "failureCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "method" "AnalysisMethod" NOT NULL,
    "fieldMappings" JSONB NOT NULL,
    "confidenceScores" JSONB NOT NULL,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "apiEndpoint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerJob" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" "WorkerJobType" NOT NULL,
    "status" "WorkerJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkerJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Site_siteUrl_key" ON "Site"("siteUrl");

-- CreateIndex
CREATE INDEX "Job_siteId_idx" ON "Job"("siteId");

-- CreateIndex
CREATE INDEX "Job_scrapeRunId_idx" ON "Job"("scrapeRunId");

-- CreateIndex
CREATE INDEX "ScrapeRun_siteId_idx" ON "ScrapeRun"("siteId");

-- CreateIndex
CREATE INDEX "AnalysisResult_siteId_idx" ON "AnalysisResult"("siteId");

-- CreateIndex
CREATE INDEX "WorkerJob_siteId_idx" ON "WorkerJob"("siteId");

-- CreateIndex
CREATE INDEX "WorkerJob_status_type_idx" ON "WorkerJob"("status", "type");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_scrapeRunId_fkey" FOREIGN KEY ("scrapeRunId") REFERENCES "ScrapeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeRun" ADD CONSTRAINT "ScrapeRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerJob" ADD CONSTRAINT "WorkerJob_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
