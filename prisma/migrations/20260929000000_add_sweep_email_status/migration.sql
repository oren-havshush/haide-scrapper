-- The sweep report is emailed through the haide-jobs WordPress mailer
-- (worker/lib/sweepMail.ts). What happened is recorded on the sweep row:
-- "sent", "sent (warning: ...)", "skipped: ..." or "failed: HTTP <status>
-- <code>: <message>". A failed send is logged and recorded, never retried and
-- never thrown into the sweep.
--
-- Nullable, no default: every earlier sweep was never emailed, and NULL says so.
-- Not a SweepCounters key - closeSweep writes it on its own, after the report
-- row is complete - so the counters spread is unaffected.

ALTER TABLE "ScrapeSweep" ADD COLUMN "emailStatus" TEXT;
