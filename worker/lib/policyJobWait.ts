// Waiting on one POLICY_REVIEW job, in two phases with two different clocks.
//
// The 06:00 policy sweep overlaps the scrape sweep's window until 08:00, on the
// same FIFO queue with one job at a time. So a policy job can sit PENDING behind
// a 17-minute scrape before anything has happened to it. Its budget —
// maxPolicyFetchSeconds + 60 — is how long a CHECK may take, and a check starts
// when the worker claims it, not when the sweep queued it. Measuring from
// enqueue reported healthy checks as timed_out on every overlapping night.
//
//   PENDING      the drain probe's rules (worker/lib/drainProbe.ts): anything
//                IN_PROGRESS inside 20 minutes is busy, keep waiting, capped at
//                20 minutes of PENDING in total; at the head of an empty queue
//                for 30 seconds is a wedged worker.
//   IN_PROGRESS  the run budget, from the job's startedAt.
//
// Injected reads, clock and sleep, so the timing is testable without a database
// or real minutes (policyJobWait.test.ts).

import { createDrainTracker, type QueueFacts } from "./drainProbe";

export type { QueueFacts };

export type JobSnapshot = { status: string; startedAt: Date | null } | null;

export type PolicyWaitDeps = {
  readJob: () => Promise<JobSnapshot>;
  readQueue: () => Promise<QueueFacts>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onWaiting?: (reason: string) => void;
};

export type PolicyWaitOptions = {
  /** maxPolicyFetchSeconds + 60, in ms — from startedAt. */
  runBudgetMs: number;
  /** The cap on PENDING time while the worker looks busy. */
  busyWaitCapMs: number;
  pollMs: number;
};

export type PolicyWaitResult =
  | { end: "COMPLETED" | "FAILED" | "MISSING" }
  | { end: "TIMED_OUT"; ranForMs: number }
  | { end: "WEDGED"; reason: string };

export async function waitForPolicyJob(
  deps: PolicyWaitDeps,
  opts: PolicyWaitOptions,
): Promise<PolicyWaitResult> {
  const drain = createDrainTracker(deps.now(), { busyWaitCapMs: opts.busyWaitCapMs });
  let firstSeenClaimedAt: number | null = null;

  for (;;) {
    const job = await deps.readJob();
    if (!job) return { end: "MISSING" };
    if (job.status === "COMPLETED" || job.status === "FAILED") return { end: job.status };

    if (job.status === "PENDING") {
      const verdict = drain.observe(await deps.readQueue(), deps.now());
      if (verdict.verdict === "wedged") return { end: "WEDGED", reason: verdict.reason };
      // "draining" while still PENDING is the claim racing this read; the next
      // poll sees IN_PROGRESS.
      if (verdict.verdict === "waiting") deps.onWaiting?.(verdict.reason);
    } else {
      // Claimed. The budget runs from startedAt; if a claimed job somehow has
      // none, from when it was first seen claimed — never from enqueue.
      firstSeenClaimedAt ??= deps.now();
      const startedAt = job.startedAt?.getTime() ?? firstSeenClaimedAt;
      const ranForMs = deps.now() - startedAt;
      if (ranForMs > opts.runBudgetMs) return { end: "TIMED_OUT", ranForMs };
    }

    await deps.sleep(opts.pollMs);
  }
}
