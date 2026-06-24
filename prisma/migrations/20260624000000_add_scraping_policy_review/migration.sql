-- CreateEnum
CREATE TYPE "ScrapingPolicyStatus" AS ENUM ('NOT_CHECKED', 'POLICY_NOT_FOUND', 'NO_EXPLICIT_RESTRICTION', 'RESTRICTED', 'REQUIRES_WRITTEN_PERMISSION', 'UNCLEAR_NEEDS_REVIEW', 'CHECK_FAILED');

-- AlterEnum
ALTER TYPE "WorkerJobType" ADD VALUE 'POLICY_REVIEW';

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "scrapingPolicyStatus" "ScrapingPolicyStatus" NOT NULL DEFAULT 'NOT_CHECKED';
ALTER TABLE "Site" ADD COLUMN "scrapingPolicyCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ScrapingPolicyReview" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "ScrapingPolicyStatus" NOT NULL,
    "isScrapingRestricted" BOOLEAN,
    "requiresWrittenPermission" BOOLEAN,
    "confidence" INTEGER,
    "language" TEXT,
    "shortReason" TEXT,
    "matchedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceSnippets" JSONB,
    "reviewedUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoveredUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewedDocTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cleanedText" TEXT,
    "llmResultJson" JSONB,
    "pagesChecked" INTEGER NOT NULL DEFAULT 0,
    "searchFallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "reviewSource" TEXT,
    "robotsChecked" BOOLEAN NOT NULL DEFAULT false,
    "robotsDisallowsAll" BOOLEAN,
    "robotsRelevantRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorMessage" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapingPolicyReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapingPolicyReview_siteId_idx" ON "ScrapingPolicyReview"("siteId");

-- CreateIndex
CREATE INDEX "ScrapingPolicyReview_status_idx" ON "ScrapingPolicyReview"("status");

-- AddForeignKey
ALTER TABLE "ScrapingPolicyReview" ADD CONSTRAINT "ScrapingPolicyReview_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
