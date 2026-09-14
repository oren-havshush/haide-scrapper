// Run: npx tsx worker/lib/policyJobWait.test.ts
//
// The 06:00 policy sweep overlaps the 03:00 scrape sweep's window until 08:00,
// on the same FIFO queue with one job at a time. A policy job queued behind a
// 17-minute scrape is not claimed for 17 minutes. Measuring its budget
// (maxPolicyFetchSeconds + 60 = 180s) from ENQUEUE times it out while it has
// not even started — a healthy check reported as timed_out, every night the two
// overlap.
//
// Simulated clock, no database: the world is a function of `t`.

import { waitForPolicyJob, type JobSnapshot, type QueueFacts } from "./policyJobWait";
import { BUSY_EVIDENCE_WINDOW_MS, HEAD_OF_QUEUE_DEADLINE_MS } from "./drainProbe";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const POLL = 5_000;
const BUDGET = (120 + 60) * 1000; // maxPolicyFetchSeconds + 60
const MIN = 60_000;

function world(script: { job: (t: number) => JobSnapshot; queue: (t: number) => QueueFacts }) {
  let t = 0;
  const waiting: string[] = [];
  return {
    deps: {
      readJob: async () => script.job(t),
      readQueue: async () => script.queue(t),
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
        // A wait that never ends must FAIL the suite, not hang it. Found by
        // mutation: with the drain rules removed, the wedged scenario looped
        // until the runner killed it, printing nothing.
        if (t > 6 * 60 * MIN) throw new Error("simulated wait passed 6 hours — the wait never ends");
      },
      onWaiting: (reason: string) => waiting.push(reason),
    },
    elapsed: () => t,
    waiting,
  };
}

const opts = { runBudgetMs: BUDGET, busyWaitCapMs: BUSY_EVIDENCE_WINDOW_MS, pollMs: POLL };

// tsx runs this as CJS, which has no top-level await.
async function main() {

// ---------------------------------------------------------------------------
// The case this is for: behind an in-flight scrape
// ---------------------------------------------------------------------------

{
  // A scrape claimed a minute before the policy job was queued runs 17 minutes.
  // The worker claims the policy job on its next poll and finishes it in 90s.
  const scrapeStart = -1 * MIN;
  const scrapeEnd = 16 * MIN;
  const claimAt = scrapeEnd + POLL;
  const doneAt = claimAt + 90_000;

  const w = world({
    job: (t) =>
      t < claimAt
        ? { status: "PENDING", startedAt: null }
        : t < doneAt
          ? { status: "IN_PROGRESS", startedAt: new Date(claimAt) }
          : { status: "COMPLETED", startedAt: new Date(claimAt) },
    queue: (t) => ({
      newestInProgressAgeMs: t < scrapeEnd ? t - scrapeStart : t >= claimAt && t < doneAt ? t - claimAt : null,
      // FIFO: an IN_PROGRESS job is not PENDING, so nothing is ahead of ours.
      probeAtHeadOfQueue: t < claimAt,
      probeClaimed: t >= claimAt,
    }),
  });

  const r = await waitForPolicyJob(w.deps, opts);
  assert(
    r.end === "COMPLETED",
    `a policy job behind a 17-minute scrape waits and completes, rather than timing out (got ${r.end} after ${Math.round(w.elapsed() / 1000)}s)`,
  );
  assert(
    w.elapsed() > BUDGET,
    "and it waited longer than the run budget — which is only right because the budget had not started",
  );
  assert(
    w.waiting.some((x) => x.includes("busy")),
    "the wait says the worker was busy, not dead",
  );
}

{
  // Behind an older PENDING job rather than an IN_PROGRESS one: the deadline
  // has not started either.
  const claimAt = 3 * MIN;
  const w = world({
    job: (t) =>
      t < claimAt
        ? { status: "PENDING", startedAt: null }
        : t < claimAt + 60_000
          ? { status: "IN_PROGRESS", startedAt: new Date(claimAt) }
          : { status: "COMPLETED", startedAt: new Date(claimAt) },
    queue: (t) => ({
      newestInProgressAgeMs: null,
      probeAtHeadOfQueue: false,
      probeClaimed: t >= claimAt,
    }),
  });
  const r = await waitForPolicyJob(w.deps, opts);
  assert(r.end === "COMPLETED", `behind an older PENDING job it waits its turn (got ${r.end})`);
}

// ---------------------------------------------------------------------------
// A genuine timeout is measured from startedAt
// ---------------------------------------------------------------------------

{
  const claimAt = 2 * MIN;
  const w = world({
    job: (t) =>
      t < claimAt
        ? { status: "PENDING", startedAt: null }
        : { status: "IN_PROGRESS", startedAt: new Date(claimAt) },
    queue: (t) => ({
      newestInProgressAgeMs: t < claimAt ? 30_000 : t - claimAt,
      probeAtHeadOfQueue: t < claimAt,
      probeClaimed: t >= claimAt,
    }),
  });
  const r = await waitForPolicyJob(w.deps, opts);
  assert(r.end === "TIMED_OUT", `a claimed job running past its budget times out (got ${r.end})`);
  assert(
    w.elapsed() > claimAt + BUDGET,
    `and not before startedAt + budget (stopped at ${Math.round(w.elapsed() / 1000)}s, startedAt ${claimAt / 1000}s + ${BUDGET / 1000}s)`,
  );
  assert(
    w.elapsed() <= claimAt + BUDGET + 2 * POLL,
    "nor long after it",
  );
  if (r.end === "TIMED_OUT") {
    assert(r.ranForMs > BUDGET, `and reports how long it had run (${r.ranForMs}ms)`);
  }
}

// ---------------------------------------------------------------------------
// While PENDING, the drain probe's rules
// ---------------------------------------------------------------------------

{
  // Head of an empty queue, nothing running: wedged after 30 seconds.
  const w = world({
    job: () => ({ status: "PENDING", startedAt: null }),
    queue: () => ({ newestInProgressAgeMs: null, probeAtHeadOfQueue: true, probeClaimed: false }),
  });
  const r = await waitForPolicyJob(w.deps, opts);
  assert(r.end === "WEDGED", `a job at the head of an empty queue is a wedged worker (got ${r.end})`);
  assert(
    w.elapsed() > HEAD_OF_QUEUE_DEADLINE_MS && w.elapsed() <= HEAD_OF_QUEUE_DEADLINE_MS + 2 * POLL,
    `after the 30-second deadline, not the run budget (stopped at ${Math.round(w.elapsed() / 1000)}s)`,
  );
  if (r.end === "WEDGED") {
    assert(r.reason.includes("not claiming"), "and says the worker is not claiming jobs");
  }
}

{
  // Busy for ever — the 20-minute cap ends the wait.
  const w = world({
    job: () => ({ status: "PENDING", startedAt: null }),
    queue: () => ({ newestInProgressAgeMs: 5 * MIN, probeAtHeadOfQueue: false, probeClaimed: false }),
  });
  const r = await waitForPolicyJob(w.deps, opts);
  assert(r.end === "WEDGED", `busy evidence cannot hold the sweep past the cap (got ${r.end})`);
  assert(
    w.elapsed() > BUSY_EVIDENCE_WINDOW_MS && w.elapsed() <= BUSY_EVIDENCE_WINDOW_MS + 2 * POLL,
    `it stops at the 20-minute cap (stopped at ${Math.round(w.elapsed() / 60_000)}m)`,
  );
}

{
  // The cap is on PENDING time only. A job claimed at 19 minutes that then runs
  // 150s is inside its own budget and must not be condemned by the queue wait.
  const claimAt = 19 * MIN;
  const w = world({
    job: (t) =>
      t < claimAt
        ? { status: "PENDING", startedAt: null }
        : t < claimAt + 150_000
          ? { status: "IN_PROGRESS", startedAt: new Date(claimAt) }
          : { status: "COMPLETED", startedAt: new Date(claimAt) },
    queue: (t) => ({
      newestInProgressAgeMs: t < claimAt ? (t % (15 * MIN)) : t - claimAt,
      probeAtHeadOfQueue: t < claimAt,
      probeClaimed: t >= claimAt,
    }),
  });
  const r = await waitForPolicyJob(w.deps, opts);
  assert(r.end === "COMPLETED", `the PENDING cap does not run on once the job is claimed (got ${r.end})`);
}

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

{
  const failed = world({
    job: () => ({ status: "FAILED", startedAt: new Date(0) }),
    queue: () => ({ newestInProgressAgeMs: null, probeAtHeadOfQueue: false, probeClaimed: true }),
  });
  assert((await waitForPolicyJob(failed.deps, opts)).end === "FAILED", "FAILED is returned as FAILED");

  const gone = world({
    job: () => null,
    queue: () => ({ newestInProgressAgeMs: null, probeAtHeadOfQueue: false, probeClaimed: false }),
  });
  assert((await waitForPolicyJob(gone.deps, opts)).end === "MISSING", "a vanished job is MISSING");
}

{
  // IN_PROGRESS without a startedAt should not happen (the dispatcher sets both
  // in one update), but if it does the budget runs from when it was first seen
  // claimed — never from enqueue, and never unbounded.
  const w = world({
    job: (t) => (t < MIN ? { status: "PENDING", startedAt: null } : { status: "IN_PROGRESS", startedAt: null }),
    queue: (t) => ({ newestInProgressAgeMs: 10_000, probeAtHeadOfQueue: t < MIN, probeClaimed: t >= MIN }),
  });
  const r = await waitForPolicyJob(w.deps, opts);
  assert(r.end === "TIMED_OUT", `a claimed job with no startedAt still times out (got ${r.end})`);
  assert(w.elapsed() > MIN + BUDGET, "from when it was first seen claimed");
}
}

// The final check runs after every scenario has awaited — it MUST stay in the
// .then, or a failing scenario prints FAIL and the suite exits 0.
main().then(
  () => {
    if (failures > 0) {
      console.error(`\n${failures} assertion(s) failed`);
      process.exit(1);
    }
    console.info("policyJobWait: the budget starts at startedAt, and PENDING follows the drain probe");
  },
  (err) => {
    console.error("policyJobWait.test crashed:", err);
    process.exit(1);
  },
);
