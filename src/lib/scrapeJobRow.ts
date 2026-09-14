// The WorkerJob row for a scrape, built in one place because two fields have to
// agree and nothing else would notice if they stopped.
//
// The ScrapeRun link is written TWICE, deliberately:
//
//   scrapeRunId          the indexed column the reaper joins on;
//   payload.scrapeRunId  what the worker reads (readScrapeRunId in
//                        worker/lib/failureCleanup.ts).
//
// Dropping either one is silent. Without the column, the reaper's structural
// rule — "the owning WorkerJob is already terminal" — cannot match the row at
// all, and the run falls through to the one-hour age backstop instead; the
// migration's backfill would then be the only thing that ever populated it, so
// every job created after the migration would be invisible to it. Without the
// payload key, the worker cannot find its own run and the scrape fails outright.
//
// Building both from one argument is what keeps them the same id.

export type ScrapeJobRowInput = {
  siteId: string;
  scrapeRunId: string;
  maxJobs?: number;
  /**
   * Only an in-process caller (the sweep driver) may set this. The HTTP route
   * allowlists `maxJobs` by name and has no way to reach it — see
   * src/lib/scrapeRequestBoundary.test.ts.
   */
  scheduled?: boolean;
};

export function buildScrapeJobRow(input: ScrapeJobRowInput) {
  return {
    siteId: input.siteId,
    type: "SCRAPE" as const,
    status: "PENDING" as const,
    scrapeRunId: input.scrapeRunId,
    payload: {
      scrapeRunId: input.scrapeRunId,
      ...(input.maxJobs ? { maxJobs: input.maxJobs } : {}),
      // Omitted entirely on a manual run, so every job already in the queue
      // reads as manual and readScheduledFlag needs no migration.
      ...(input.scheduled ? { scheduled: true } : {}),
    },
  };
}
