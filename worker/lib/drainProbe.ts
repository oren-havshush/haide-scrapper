// Is the worker actually claiming jobs?
//
// A sweep that enqueues 145 sites at a dead worker produces a night of perfect
// silence and a report saying nothing failed. So the driver proves the queue is
// draining before it touches anything.
//
// There is no heartbeat in worker/index.ts, and the compose healthcheck only
// greps `ps` — which proves the process exists, not that it is polling. Rather
// than add a heartbeat table, the sweep probes with its FIRST site and watches
// what happens to it.
//
// The naive version of that probe aborts the whole night whenever anything else
// is already queued. `pollForJobs` is FIFO and gated by `isProcessing`, so a
// manual scrape started at 02:58 holds the worker for up to fifteen minutes and
// a queued policy job for up to two. The probe's `startedAt` would stay null far
// past any short deadline, and the sweep would halt with "worker not draining"
// against a worker that is visibly working.
//
// Hence two rules, in order:
//
//   1. ANY job is IN_PROGRESS with a startedAt inside the last 20 minutes — the
//      worker is demonstrably working, just busy. Wait, do not abort.
//   2. Otherwise the probe must reach the HEAD of the queue (no older PENDING
//      job), and only from that moment does the short deadline apply.
//
// Only a probe sitting at the head of an otherwise empty queue, with nothing
// IN_PROGRESS, for the whole window, is a wedged worker.

/** Anything IN_PROGRESS newer than this proves the worker is alive. */
export const BUSY_EVIDENCE_WINDOW_MS = 20 * 60_000; // 20 minutes

/** POLL_INTERVAL_MS (5s) x 6 — six chances to claim before we call it dead. */
export const HEAD_OF_QUEUE_DEADLINE_MS = 30_000;

export type DrainInput = {
  /**
   * How long ago the newest IN_PROGRESS WorkerJob started, in ms. Null when
   * nothing is IN_PROGRESS or none carries a startedAt.
   */
  newestInProgressAgeMs: number | null;
  /** True once no PENDING job older than the probe exists. */
  probeAtHeadOfQueue: boolean;
  /** How long the probe has been at the head. Null until it gets there. */
  probeAtHeadForMs: number | null;
  /** The probe itself has been claimed — the strongest possible evidence. */
  probeClaimed: boolean;
};

export type DrainVerdict = {
  verdict: "draining" | "waiting" | "wedged";
  reason: string;
};

export function assessDrain(
  input: DrainInput,
  opts: {
    busyEvidenceWindowMs?: number;
    headOfQueueDeadlineMs?: number;
  } = {},
): DrainVerdict {
  const busyWindow = opts.busyEvidenceWindowMs ?? BUSY_EVIDENCE_WINDOW_MS;
  const deadline = opts.headOfQueueDeadlineMs ?? HEAD_OF_QUEUE_DEADLINE_MS;

  // The probe was picked up. Nothing else needs proving.
  if (input.probeClaimed) {
    return { verdict: "draining", reason: "the probe job was claimed" };
  }

  // Rule 1: something else is being worked on, recently enough to believe.
  if (input.newestInProgressAgeMs !== null && input.newestInProgressAgeMs <= busyWindow) {
    return {
      verdict: "waiting",
      reason: `a job has been IN_PROGRESS for ${Math.round(input.newestInProgressAgeMs / 60_000)}m — the worker is busy, not dead`,
    };
  }

  // Rule 2: the deadline only starts once the probe is actually next in line.
  if (!input.probeAtHeadOfQueue) {
    return {
      verdict: "waiting",
      reason: "older PENDING jobs are ahead of the probe; the deadline has not started",
    };
  }

  const waited = input.probeAtHeadForMs ?? 0;
  if (waited <= deadline) {
    return {
      verdict: "waiting",
      reason: `probe at the head for ${Math.round(waited / 1000)}s of ${Math.round(deadline / 1000)}s`,
    };
  }

  return {
    verdict: "wedged",
    reason:
      `the probe sat at the head of an empty queue for ${Math.round(waited / 1000)}s ` +
      `with nothing IN_PROGRESS — the worker is not claiming jobs`,
  };
}
