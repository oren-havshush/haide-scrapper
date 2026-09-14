// Run: npx tsx worker/lib/drainProbe.test.ts
//
// Both errors here are expensive and neither announces itself:
//
//   too eager to abort — a sweep halts with "worker not draining" against a
//     worker that is visibly mid-scrape, and the night is lost for no reason;
//   too slow to abort  — 145 sites are enqueued at a dead worker and the report
//     says nothing failed, because nothing ran.
//
// Most of the cases below are the first kind, because that is the one the naive
// probe gets wrong.

import {
  BUSY_EVIDENCE_WINDOW_MS,
  HEAD_OF_QUEUE_DEADLINE_MS,
  assessDrain,
  type DrainInput,
} from "./drainProbe";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const base: DrainInput = {
  newestInProgressAgeMs: null,
  probeAtHeadOfQueue: true,
  probeAtHeadForMs: 0,
  probeClaimed: false,
};

// --- the strongest evidence --------------------------------------------

assert(
  assessDrain({ ...base, probeClaimed: true }).verdict === "draining",
  "a claimed probe settles it",
);
assert(
  assessDrain({
    ...base,
    probeClaimed: true,
    probeAtHeadForMs: 10 * 60_000,
    newestInProgressAgeMs: null,
  }).verdict === "draining",
  "and nothing else can override it",
);

// --- rule 1: busy is not dead ------------------------------------------

{
  // A manual scrape started at 02:58 holds the worker for up to 15 minutes.
  // This is the case the naive probe fails.
  const v = assessDrain({ ...base, newestInProgressAgeMs: 9 * 60_000, probeAtHeadForMs: 60_000 });
  assert(v.verdict === "waiting", "a 9-minute-old IN_PROGRESS job means busy, not wedged");
  assert(v.reason.includes("9m"), "and the reason says how long it has been running");
}

assert(
  assessDrain({ ...base, newestInProgressAgeMs: BUSY_EVIDENCE_WINDOW_MS }).verdict === "waiting",
  "exactly at the busy window still counts as evidence of life",
);

{
  // Past the window, an IN_PROGRESS job is no longer evidence of anything — it
  // is what a wedged worker looks like. Fall through to the queue rules.
  const v = assessDrain({
    ...base,
    newestInProgressAgeMs: BUSY_EVIDENCE_WINDOW_MS + 1,
    probeAtHeadForMs: HEAD_OF_QUEUE_DEADLINE_MS + 1,
  });
  assert(
    v.verdict === "wedged",
    "a job stuck IN_PROGRESS past the window stops vouching for the worker",
  );
}

// --- rule 2: the deadline starts at the head of the queue --------------

{
  // A queued policy job holds the worker for up to 2 minutes. The probe sits
  // behind it with startedAt null the whole time — far past 30s.
  const v = assessDrain({
    ...base,
    probeAtHeadOfQueue: false,
    probeAtHeadForMs: null,
    newestInProgressAgeMs: null,
  });
  assert(
    v.verdict === "waiting",
    "behind an older PENDING job, the deadline has not started — this is the abort the naive probe would make",
  );
  assert(v.reason.includes("older PENDING"), "and it says what it is waiting behind");
}

{
  const v = assessDrain({ ...base, probeAtHeadForMs: HEAD_OF_QUEUE_DEADLINE_MS });
  assert(v.verdict === "waiting", "exactly at the deadline is not yet past it");
  assert(
    assessDrain({ ...base, probeAtHeadForMs: HEAD_OF_QUEUE_DEADLINE_MS + 1 }).verdict === "wedged",
    "one millisecond past it is",
  );
}

// --- the only wedged verdict -------------------------------------------

{
  const v = assessDrain({
    newestInProgressAgeMs: null,
    probeAtHeadOfQueue: true,
    probeAtHeadForMs: 45_000,
    probeClaimed: false,
  });
  assert(v.verdict === "wedged", "head of an empty queue, nothing running, past the deadline");
  assert(
    v.reason.includes("not claiming jobs"),
    "and says the thing an operator needs to act on",
  );
}

// The deadline is six poll intervals, so a single missed tick cannot condemn
// a healthy worker.
assert(
  HEAD_OF_QUEUE_DEADLINE_MS >= 6 * 5_000,
  "the deadline allows at least six poll intervals",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("drainProbe: busy is not dead, and dead is not missed");
