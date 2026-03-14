-- AlterTable: Update Job model fields
-- Drop old columns: company, salary
-- Add new columns: requirements, department, externalJobId, publishDate, applicationInfo

ALTER TABLE "Job" DROP COLUMN "company";
ALTER TABLE "Job" DROP COLUMN "salary";

ALTER TABLE "Job" ADD COLUMN "requirements" TEXT;
ALTER TABLE "Job" ADD COLUMN "department" TEXT;
ALTER TABLE "Job" ADD COLUMN "externalJobId" TEXT;
ALTER TABLE "Job" ADD COLUMN "publishDate" TEXT;
ALTER TABLE "Job" ADD COLUMN "applicationInfo" TEXT;
