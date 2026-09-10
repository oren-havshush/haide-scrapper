// What the worker may do to a site when a job's handler throws, or when the
// worker is restarted while a job was in flight.
//
// Both callers (jobDispatcher's catch, and recoverInterruptedJobs at boot) used
// to delete every Job row for the site and set it FAILED. That is a data-loss
// mechanism: an escaped exception is evidence about the *worker* — a transient
// DB blip, a browser crash, a deploy mid-scrape — and says nothing about whether
// the site's listings are still good. A scheduled nightly over 145 sites would
// have fired it routinely.
//
// The replacement rule is status-driven, not job-type driven:
//
//   ANALYZING is the one transient status that only a job can leave. A site
//   stranded there is invisible in the failures view and cannot be scraped at
//   all (scrapeAllowedStatuses in siteService excludes it), so it is rescued to
//   FAILED. Every other status is a settled decision the worker has no business
//   overriding.
//
// A type-based rule would not be enough: handleAnalysisJob has no catch of its
// own, but scanUrlForPolicy also creates sites in ANALYZING and hands them to a
// POLICY_REVIEW job, so those strand identically.
//
// Nothing here ever deletes a Job row.

/** The one site status the worker is allowed to move a site out of on failure. */
export const TRANSIENT_SITE_STATUS = "ANALYZING";

export type FailureCleanup = {
  /**
   * Close the linked ScrapeRun. The caller must additionally scope the write to
   * rows still IN_PROGRESS — a run the handler already finished must never be
   * relabelled FAILED.
   */
  closeScrapeRun: boolean;
  /** Move the site out of the transient ANALYZING state (never deletes rows). */
  rescueSite: boolean;
  /**
   * Emit site:status-changed. Only ever true when the status really changed —
   * the old dispatcher emitted FAILED unconditionally and told the dashboard a
   * site had failed when nothing about it had moved.
   */
  emitStatusChange: boolean;
};

export function planFailureCleanup(input: {
  siteStatus: string | null | undefined;
  scrapeRunId: string | null | undefined;
}): FailureCleanup {
  const rescueSite = input.siteStatus === TRANSIENT_SITE_STATUS;
  return {
    closeScrapeRun: typeof input.scrapeRunId === "string" && input.scrapeRunId.length > 0,
    rescueSite,
    emitStatusChange: rescueSite,
  };
}

/**
 * Read the WorkerJob -> ScrapeRun link out of a job payload.
 *
 * The link lives only inside the unindexed JSON payload today; a dedicated
 * WorkerJob.scrapeRunId column arrives with the sweep migration. Until then both
 * callers read it from here, so there is one definition to change.
 */
export function readScrapeRunId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).scrapeRunId;
  return typeof value === "string" && value.length > 0 ? value : null;
}
