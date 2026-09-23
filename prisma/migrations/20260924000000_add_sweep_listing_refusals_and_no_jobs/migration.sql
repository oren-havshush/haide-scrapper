-- The two counters that split `silentDrift` into the three different things it
-- had been conflating: a site that changed under us and said nothing (drift), a
-- multi-page site declining to publish a partial set (a refusal, the opposite
-- of a problem), and a site that returned nothing and had nothing.
--
-- They were added to SweepCounters without these columns. `closeSweep` spreads
-- the whole counters object into the ScrapeSweep row, so the first real sweep
-- ended with Prisma's "Unknown argument `listingRefusals`" AFTER all 145 sites
-- had been scraped — every per-site item written, the report rendered, and the
-- sweep row left RUNNING with no counters and no logText.
--
-- Additive, NOT NULL with a default, so existing rows read 0 — which is true of
-- them: neither quantity was measured when they were written.

ALTER TABLE "ScrapeSweep"
  ADD COLUMN "listingRefusals" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "noJobs" INTEGER NOT NULL DEFAULT 0;
