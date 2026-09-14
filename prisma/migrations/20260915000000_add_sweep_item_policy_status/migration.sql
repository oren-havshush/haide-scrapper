-- Policy-phase items carried their before/after scrapingPolicyStatus in
-- "wouldPromoteTo" and "failureCategory", columns that mean something else
-- (the status page rendered a policy status as "promote → …"). Two columns of
-- their own instead.
--
-- Additive and nullable: no rewrite, no backfill. No policy items exist on
-- production — the policy sweep has never run there.

ALTER TABLE "ScrapeSweepItem"
  ADD COLUMN "policyStatusBefore" TEXT,
  ADD COLUMN "policyStatusAfter" TEXT;
