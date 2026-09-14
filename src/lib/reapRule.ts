// When a ScrapeRun left IN_PROGRESS is dead, and when it is merely busy.
//
// A run stuck IN_PROGRESS blocks its site: `createScrapeRun` refuses a site that
// already has one, so until something closes it the site cannot be scraped by
// hand or by the nightly. Non-destructive boot recovery (worker/index.ts) closes
// the runs it can see, but orphans predating it — and any run whose worker died
// without booting again — need this.
//
// The definition is STRUCTURAL, not time-based: a run is orphaned when the
// WorkerJob that owned it has already reached a terminal state. Time only enters
// as a backstop for the two cases where there is no such signal.
//
// ---------------------------------------------------------------------------
// Why the two callers cannot share a default
// ---------------------------------------------------------------------------
//
// Boot recovery runs in a process that has just started. Nothing it finds
// IN_PROGRESS can be running, because the only thing that could be running it is
// this process, and it has not begun. Every such run is dead.
//
// The sweep pre-flight runs while the worker is up and may legitimately be
// fifteen minutes into a scrape. Reaping on the same assumption would close a
// live run out from under it, and the scrape would then finish and write to a
// row the reaper had already marked FAILED — two writers of terminal state,
// which is the exact defect worker/lib/abortToken.ts exists to prevent.
//
// So `workerIsLive` is required at every call site. There is deliberately no
// default: a wrong guess here is silent, and the safe value differs per caller.

/**
 * A WorkerJob is terminal once it can no longer be doing anything. Any run it
 * still holds open is therefore abandoned, whatever the clock says.
 */
export const TERMINAL_JOB_STATUSES = ["COMPLETED", "FAILED"] as const;

/**
 * A run with no WorkerJob at all — the link was never written, or the job row is
 * gone — is only reaped once it is older than this. The grace exists because
 * `createScrapeRun` writes the ScrapeRun and the WorkerJob in one transaction
 * but a reader mid-transaction could briefly see neither.
 */
export const NO_JOB_GRACE_MS = 60 * 60_000; // 1 hour

/** What the sweep pre-flight allows a genuinely running scrape. */
export const SWEEP_IN_PROGRESS_GRACE_MS = 20 * 60_000; // 20 minutes

export type ReapInput = {
  /** Age of the ScrapeRun row itself. */
  runAgeMs: number;
  /**
   * The owning WorkerJob's status, or null when the run has no job — either
   * because the link predates the column or because the row was deleted.
   */
  jobStatus: string | null;
  /** How long that job has been IN_PROGRESS. Null unless it is. */
  jobInProgressForMs: number | null;
};

export type ReapOptions = {
  /**
   * Whether a worker process could currently be executing these jobs.
   *
   * `false` at boot — the process that owned them is gone and this one has not
   * started polling. `true` from the sweep pre-flight, where the worker is up.
   */
  workerIsLive: boolean;
  /**
   * How long a job may sit IN_PROGRESS before it is presumed dead anyway.
   * Only consulted when `workerIsLive` is true; at boot nothing is alive, so
   * there is nothing to wait for.
   */
  inProgressGraceMs: number;
};

export type ReapVerdict = {
  reap: boolean;
  /** Why, for the log. Runs are closed rarely and each one wants explaining. */
  reason: string;
};

export function shouldReapRun(input: ReapInput, opts: ReapOptions): ReapVerdict {
  // 1. The structural case, and the only one that needs no clock.
  if (input.jobStatus !== null && TERMINAL_JOB_STATUSES.includes(input.jobStatus as never)) {
    return { reap: true, reason: `owning WorkerJob is ${input.jobStatus}` };
  }

  // 2. No owning job. Reap only once the creating transaction cannot still be
  //    open, since a run and its job are written together.
  if (input.jobStatus === null) {
    return input.runAgeMs > NO_JOB_GRACE_MS
      ? { reap: true, reason: `no owning WorkerJob and older than ${NO_JOB_GRACE_MS / 60_000}m` }
      : { reap: false, reason: "no owning WorkerJob, still inside the creation grace" };
  }

  // 3. The job says IN_PROGRESS. Everything now turns on whether a worker is
  //    actually up to be running it.
  if (input.jobStatus === "IN_PROGRESS") {
    if (!opts.workerIsLive) {
      return { reap: true, reason: "worker is not live, so nothing can still be running it" };
    }
    const runningFor = input.jobInProgressForMs;
    if (runningFor !== null && runningFor > opts.inProgressGraceMs) {
      return {
        reap: true,
        reason: `IN_PROGRESS for ${Math.round(runningFor / 60_000)}m, past the ${Math.round(opts.inProgressGraceMs / 60_000)}m grace`,
      };
    }
    return { reap: false, reason: "a live worker may still be scraping this" };
  }

  // 4. PENDING, or a status this build does not know. Leaving it is the
  //    conservative reading: a PENDING job is about to be picked up, and an
  //    unrecognised status is not evidence of death.
  return { reap: false, reason: `owning WorkerJob is ${input.jobStatus}` };
}
