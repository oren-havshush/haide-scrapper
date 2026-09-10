// Run: npx tsx worker/lib/abortToken.test.ts
//
// The property under test is "exactly one writer of terminal state". Every case
// below is really the same question asked from a different side: when the
// 15-minute deadline and the persistence transaction race, who wins?

import {
  awaitCommit,
  beginCommit,
  createAbortToken,
  isAborted,
  requestAbort,
} from "./abortToken";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- the ordinary cases -------------------------------------------------

{
  const t = createAbortToken();
  assert(t.phase === "running", "a fresh token is running");
  assert(!isAborted(t), "a fresh token is not aborted");
  assert(awaitCommit(t) === null, "no transaction, nothing to await");
}

{
  // Deadline before any transaction opened: the abort takes effect, and the
  // persistence path must refuse to start. This is the case where the previous
  // listings survive untouched.
  const t = createAbortToken<string>();
  assert(requestAbort(t, "timeout").outcome === "accepted", "an idle token aborts");
  assert(isAborted(t), "the token is aborted");
  assert(t.reason === "timeout", "the reason is kept for the report");
  assert(
    beginCommit(t, () => Promise.resolve("wrote rows")) === null,
    "an aborted token refuses to OPEN a transaction — this is what keeps the listings",
  );
}

{
  const t = createAbortToken();
  requestAbort(t, "first");
  const second = requestAbort(t, "second");
  assert(second.outcome === "already-aborted", "a second abort does not re-fire");
  assert(t.reason === "first", "the first reason stands");
}

// --- the race this module exists for (N3, F2) ---------------------------

{
  // The deadline fires while the transaction is committing. The handler must
  // neither write terminal state nor reject: it defers to the transaction.
  const t = createAbortToken<string>();
  const promise = beginCommit(t, () => Promise.resolve("COMPLETED"));
  assert(promise !== null, "a running token opens the commit window");
  assert(t.phase === "committing", "the token is committing");

  const req = requestAbort(t, "timeout");
  assert(
    req.outcome === "deferred",
    "the timeout handler defers — writing here is what makes the log contradict the DB",
  );
  assert(!isAborted(t), "deferring does not abort: the transaction is still the authority");
  assert(awaitCommit(t) === promise, "the handler awaits the transaction's own outcome");
}

// --- ordering: the gap that would let both write -------------------------

{
  // beginCommit must flip the phase BEFORE invoking `start`, with no await in
  // between. If it flipped afterwards, an abort raised from inside `start`
  // would be accepted, and both the handler and the transaction would write.
  const t = createAbortToken<string>();
  let phaseSeenInsideStart = "";
  beginCommit(t, () => {
    phaseSeenInsideStart = t.phase;
    return Promise.resolve("ok");
  });
  assert(
    phaseSeenInsideStart === "committing",
    "the commit window is already open when the transaction starts",
  );
}

async function asyncCases() {
  {
    // The window is one-way. Once a transaction has settled it is STILL the
    // authority — a late timeout must not resurrect itself and write FAILED
    // over a committed COMPLETED.
    const t = createAbortToken<string>();
    const promise = beginCommit(t, () => Promise.resolve("COMPLETED"));
    await promise;
    assert(
      requestAbort(t, "late timeout").outcome === "deferred",
      "a settled transaction still owns the outcome",
    );
    assert(awaitCommit(t) !== null, "its result is still available to report");
  }

  {
    // A rolled-back transaction. The token still says `committing`, so the
    // timeout handler still defers — but awaiting it rejects, which is the
    // signal to the catch block that nothing was written and it may fail the
    // run.
    const t = createAbortToken<string>();
    const promise = beginCommit(t, () => Promise.reject(new Error("rollback")));
    assert(requestAbort(t, "timeout").outcome === "deferred", "a rollback still defers first");
    let rejected = false;
    try {
      await promise;
    } catch {
      rejected = true;
    }
    assert(rejected, "the rollback surfaces to whoever awaits the commit");
  }
}

asyncCases().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("abortToken: exactly one writer of terminal state");
});
