// Run: npx tsx src/lib/reapRule.test.ts
//
// The reaper closes runs that block their site forever. Both directions are
// expensive and they pull against each other:
//
//   too shy  — a site stays unscrapeable until someone notices by hand;
//   too keen — a live 15-minute scrape gets its run marked FAILED underneath it,
//              and then finishes and writes COMPLETED over that. Two writers of
//              terminal state, which is the defect abortToken.ts exists to stop.
//
// Which way it errs is decided entirely by `workerIsLive`, so most of this file
// is the same input asked twice, once per caller.

import {
  NO_JOB_GRACE_MS,
  SWEEP_IN_PROGRESS_GRACE_MS,
  shouldReapRun,
  type ReapOptions,
} from "./reapRule";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const AT_BOOT: ReapOptions = { workerIsLive: false, inProgressGraceMs: 0 };
const FROM_SWEEP: ReapOptions = {
  workerIsLive: true,
  inProgressGraceMs: SWEEP_IN_PROGRESS_GRACE_MS,
};

const MINUTE = 60_000;

// --- the structural case: no clock involved -----------------------------

for (const [name, opts] of [["boot", AT_BOOT], ["sweep", FROM_SWEEP]] as const) {
  for (const terminal of ["COMPLETED", "FAILED"]) {
    const v = shouldReapRun(
      { runAgeMs: 30_000, jobStatus: terminal, jobInProgressForMs: null },
      opts,
    );
    assert(
      v.reap,
      `${name}: a run whose WorkerJob is ${terminal} is orphaned however new it is`,
    );
  }
}

// A fresh terminal job still counts. The structural signal is not a timeout —
// if the job is done, nothing is coming back to close the run.
assert(
  shouldReapRun({ runAgeMs: 1, jobStatus: "FAILED", jobInProgressForMs: null }, FROM_SWEEP).reap,
  "even a one-millisecond-old run is orphaned once its job is terminal",
);

// --- the case the two callers must answer differently -------------------

{
  // A job IN_PROGRESS for two minutes. At boot this is a corpse: the process
  // that owned it is gone. From the sweep it is a scrape that started two
  // minutes ago and has thirteen minutes left.
  const input = { runAgeMs: 3 * MINUTE, jobStatus: "IN_PROGRESS", jobInProgressForMs: 2 * MINUTE };

  assert(
    shouldReapRun(input, AT_BOOT).reap,
    "at boot, an IN_PROGRESS job cannot be running — this process has not started polling",
  );
  assert(
    !shouldReapRun(input, FROM_SWEEP).reap,
    "from the sweep, the same job may be a live scrape and must be left alone",
  );
}

{
  // An IN_PROGRESS job with NO startedAt — the row was moved to IN_PROGRESS
  // without one, or predates the field being set reliably.
  //
  // This is the case that makes `workerIsLive` load-bearing rather than a
  // restatement of `inProgressGraceMs: 0`. With no elapsed time to compare, the
  // grace check cannot fire at all, so without the explicit short-circuit a
  // boot-time reap would fall through and leave the run open forever — the
  // precise failure the reaper exists to prevent.
  const noStart = { runAgeMs: 45 * MINUTE, jobStatus: "IN_PROGRESS", jobInProgressForMs: null };

  assert(
    shouldReapRun(noStart, AT_BOOT).reap,
    "at boot, an IN_PROGRESS job with no startedAt is still dead — nothing is running it",
  );
  assert(
    !shouldReapRun(noStart, FROM_SWEEP).reap,
    "from the sweep, an unknown start time is not evidence of death; leave it for the next pass",
  );
}

{
  // Past the sweep's grace, it is dead either way.
  const input = {
    runAgeMs: 25 * MINUTE,
    jobStatus: "IN_PROGRESS",
    jobInProgressForMs: 21 * MINUTE,
  };
  assert(shouldReapRun(input, FROM_SWEEP).reap, "21m of IN_PROGRESS is past the 20m grace");
  assert(
    shouldReapRun(input, FROM_SWEEP).reason.includes("21m"),
    "and the reason says how long, so the log can be read",
  );
}

{
  // The boundary. The grace is exclusive: exactly at it, the scrape is still
  // inside its budget.
  const atGrace = {
    runAgeMs: 30 * MINUTE,
    jobStatus: "IN_PROGRESS",
    jobInProgressForMs: SWEEP_IN_PROGRESS_GRACE_MS,
  };
  assert(!shouldReapRun(atGrace, FROM_SWEEP).reap, "exactly at the grace is not yet past it");
  assert(
    shouldReapRun(
      { ...atGrace, jobInProgressForMs: SWEEP_IN_PROGRESS_GRACE_MS + 1 },
      FROM_SWEEP,
    ).reap,
    "one millisecond past it is",
  );
}

// The 20-minute grace must outlast the 15-minute scrape timeout plus the
// 2-minute transaction budget, or the sweep reaps runs that are still
// committing. 17 minutes worst case, 20 allowed.
assert(
  SWEEP_IN_PROGRESS_GRACE_MS > 15 * MINUTE + 2 * MINUTE,
  "the sweep grace leaves room for a 15m scrape that overruns while committing",
);

// --- no owning job at all -----------------------------------------------

{
  // createScrapeRun writes the run and its job in one transaction, so a reader
  // can briefly see the run alone. Reaping it would kill a scrape that had not
  // started yet.
  const fresh = { runAgeMs: 5 * MINUTE, jobStatus: null, jobInProgressForMs: null };
  assert(!shouldReapRun(fresh, AT_BOOT).reap, "a job-less run inside the grace is left alone");
  assert(!shouldReapRun(fresh, FROM_SWEEP).reap, "from the sweep too");

  const old = { runAgeMs: NO_JOB_GRACE_MS + 1, jobStatus: null, jobInProgressForMs: null };
  assert(shouldReapRun(old, AT_BOOT).reap, "past an hour with no job, it is abandoned");
  assert(shouldReapRun(old, FROM_SWEEP).reap, "and the sweep agrees — no job means no writer");
}

// This is the backstop that catches the 59 pre-migration rows whose payload
// names a ScrapeRun that clearSiteJobs deleted: the link backfills to NULL, so
// the run presents with no owning job.
assert(
  shouldReapRun(
    { runAgeMs: 90 * MINUTE, jobStatus: null, jobInProgressForMs: null },
    AT_BOOT,
  ).reason.includes("no owning WorkerJob"),
  "a run with no discoverable owner is reaped for that reason, and says so",
);

// --- statuses that are not evidence of death ----------------------------

for (const [name, opts] of [["boot", AT_BOOT], ["sweep", FROM_SWEEP]] as const) {
  assert(
    !shouldReapRun(
      { runAgeMs: 5 * MINUTE, jobStatus: "PENDING", jobInProgressForMs: null },
      opts,
    ).reap,
    `${name}: a PENDING job is about to be picked up, not dead`,
  );
  assert(
    !shouldReapRun(
      { runAgeMs: 99 * MINUTE, jobStatus: "SOMETHING_NEW", jobInProgressForMs: null },
      opts,
    ).reap,
    `${name}: an unrecognised status is not evidence of death — leaving it is the conservative read`,
  );
}

// A PENDING job is never reaped on age alone. If that changed, the reaper would
// start cancelling queued work simply for sitting in a backlog.
assert(
  !shouldReapRun(
    { runAgeMs: 10 * 60 * MINUTE, jobStatus: "PENDING", jobInProgressForMs: null },
    FROM_SWEEP,
  ).reap,
  "a ten-hour-old PENDING job is a backlog, not an orphan",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("reapRule: orphans are closed, live scrapes are not");
