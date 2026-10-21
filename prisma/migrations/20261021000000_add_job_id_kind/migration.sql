-- Job.idKind (report fixes 3, item 1, 2026-10-21): what kind of id
-- externalJobId is. "synthesised" when it starts with "h-": a hash, the
-- worker's (worker/lib/synthesizeJobId.ts) or a setupScript's own, with no
-- printed number in it. "native" for every other id. The worker writes it on
-- every row by the same rule.
--
-- Not null with a default, so the public site, which reads Job directly, sees
-- a value on every row at once. On 2026-10-21 every h- id in the fleet was a
-- hash: the worker's (1 to 7 base-36) or four sites' scripts (8 hex).

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "idKind" TEXT NOT NULL DEFAULT 'native';

-- Backfill
UPDATE "Job" SET "idKind" = 'synthesised' WHERE "externalJobId" LIKE 'h-%';
