-- Add deadline to Job (application cutoff date, distinct from publishDate)
ALTER TABLE "Job" ADD COLUMN "deadline" TEXT;
