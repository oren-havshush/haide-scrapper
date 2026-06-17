-- Add ageBucket to Job for age-based flagging (fresh / d90 / d180 / d365)
ALTER TABLE "Job" ADD COLUMN "ageBucket" TEXT;

CREATE INDEX "Job_ageBucket_idx" ON "Job"("ageBucket");
