// One policy-sweep site result: decided once, written twice.
//
// The driver used to build the persisted ScrapeSweepItem and the in-memory
// ReportItem separately, and they disagreed — the row carried the site's
// lifecycle status in `siteStatus`, the report carried the policy status in the
// same field, and the before/after policy statuses rode in `wouldPromoteTo` and
// `failureCategory`, columns that mean something else. Both shapes now come from
// one result object here, so there is nothing left for them to disagree about.
//
// No Prisma import, so the whole path from a driver result to the verdict line
// is testable without a database (policySweepReport.test.ts).

import { becameRestricted } from "../../src/lib/policySelection";
import type { ReportItem } from "./sweepReport";

export const POLICY_OUTCOME = {
  /** The job COMPLETED and the site entered a restricting status tonight. */
  NEWLY_RESTRICTED: "newly_restricted",
  /** The job COMPLETED with a usable status. */
  SUCCESS: "success",
  /**
   * The job COMPLETED but the handler could not establish a status. The handler
   * never throws — its failures are a COMPLETED job with the site set to
   * CHECK_FAILED — so this is read off the site, not the job.
   */
  CHECK_FAILED: "check_failed",
  /** The WorkerJob itself ended FAILED, or vanished. */
  JOB_FAILED: "job_failed",
  /** Claimed, and still running past its budget measured from startedAt. */
  TIMED_OUT: "timed_out",
  /** A POLICY_REVIEW job for the site was already PENDING or IN_PROGRESS. */
  SKIPPED_CONFLICT: "skipped_conflict",
  /** The drain probe's rules said the worker is not claiming jobs. */
  WORKER_NOT_DRAINING: "worker_not_draining",
} as const;

/** How the sweep's wait on one policy job ended. */
export type PolicyJobEnd =
  | "COMPLETED"
  | "FAILED"
  | "MISSING"
  | "TIMED_OUT"
  | "WEDGED"
  | "ALREADY_QUEUED";

export function decidePolicyOutcome(input: {
  jobEnd: PolicyJobEnd;
  before: string;
  after: string;
}): string {
  switch (input.jobEnd) {
    case "ALREADY_QUEUED":
      return POLICY_OUTCOME.SKIPPED_CONFLICT;
    case "WEDGED":
      return POLICY_OUTCOME.WORKER_NOT_DRAINING;
    case "TIMED_OUT":
      return POLICY_OUTCOME.TIMED_OUT;
    case "FAILED":
    case "MISSING":
      return POLICY_OUTCOME.JOB_FAILED;
    case "COMPLETED":
      // "Newly RESTRICTED" is a TRANSITION, not a census: a site already
      // RESTRICTED last month is not news tonight.
      if (becameRestricted(input.before, input.after)) return POLICY_OUTCOME.NEWLY_RESTRICTED;
      if (input.after === "CHECK_FAILED") return POLICY_OUTCOME.CHECK_FAILED;
      return POLICY_OUTCOME.SUCCESS;
  }
}

export type PolicySiteResult = {
  siteId: string;
  siteUrl: string;
  /** The site's LIFECYCLE status (ACTIVE, REVIEW, …) — never a policy status. */
  siteStatus: string;
  policyStatusBefore: string;
  policyStatusAfter: string;
  /**
   * The site's listing count, read before the job is queued and again after
   * the wait. A policy check never touches listings; these are recorded so the
   * row states the site's real count instead of a 0 that nobody measured.
   */
  jobsBefore: number;
  jobsAfter: number;
  outcome: string;
  /** In-memory only, like the scrape sweep's; reaches logText, not a column. */
  defect: string | null;
  startedAt: Date;
  finishedAt: Date;
};

export function toPolicyReportItem(r: PolicySiteResult): ReportItem {
  return {
    siteId: r.siteId,
    siteUrl: r.siteUrl,
    phase: "policy",
    outcome: r.outcome,
    failureCategory: null,
    jobsBefore: r.jobsBefore,
    jobsAfter: r.jobsAfter,
    newestJobAt: null,
    siteStatus: r.siteStatus,
    wouldDemoteTo: null,
    wouldPromoteTo: null,
    policyStatusBefore: r.policyStatusBefore,
    policyStatusAfter: r.policyStatusAfter,
    defect: r.defect,
  };
}

/** The ScrapeSweepItem row, from the same result and the same fields. */
export function toPolicyItemRow(r: PolicySiteResult, sweepId: string) {
  const item = toPolicyReportItem(r);
  return {
    sweepId,
    siteId: item.siteId,
    phase: item.phase,
    scrapeRunId: null,
    outcome: item.outcome,
    failureCategory: item.failureCategory,
    jobsBefore: item.jobsBefore,
    jobsAfter: item.jobsAfter,
    newestJobAt: item.newestJobAt,
    siteStatus: item.siteStatus,
    wouldDemoteTo: item.wouldDemoteTo,
    wouldPromoteTo: item.wouldPromoteTo,
    policyStatusBefore: item.policyStatusBefore ?? null,
    policyStatusAfter: item.policyStatusAfter ?? null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}
