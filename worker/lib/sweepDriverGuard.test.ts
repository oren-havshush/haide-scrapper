// Run: npx tsx worker/lib/sweepDriverGuard.test.ts
//
// Two claims about the driver that cannot be checked without a database and a
// browser, and which would be expensive to discover by running it:
//
//   1. `--dry-run` writes nothing. It is the thing an operator runs against
//      production to see what tonight WOULD do, so a single stray create makes
//      it a live run with a misleading name.
//   2. The driver is the only caller that passes `scheduled: true`. That flag
//      suppresses every site-mutating write in scrape.ts, so a second caller is
//      a second place a site can be silently skipped, or not.
//
// Source-level, in the same spirit as nonDestructiveRecovery.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const driverPath = join(ROOT, "worker", "sweep", "nightly.ts");
const driverRaw = readFileSync(driverPath, "utf8");
const driver = strip(driverRaw);

assert(driver.length > 2000, `the driver was actually read (${driver.length} chars)`);

/** A named top-level function's body, to the first lone `}` in column 0. */
function functionBody(src: string, name: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^(async )?function ${name}\\(`).test(l));
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && l === "}");
  if (end === -1) return "";
  return lines.slice(start, end + 1).join("\n");
}

// ---------------------------------------------------------------------------
// 1. --dry-run writes nothing
// ---------------------------------------------------------------------------

const dry = functionBody(driver, "dryRun");
assert(dry.length > 400, `dryRun's body was extracted (${dry.length} chars)`);
assert(dry.includes("selectSitesForSweep"), "and it is the function that prints the selection");

const WRITE_CALLS = [
  "createScrapeRun(",
  ".create(",
  ".createMany(",
  ".update(",
  ".updateMany(",
  ".delete(",
  ".deleteMany(",
  ".upsert(",
];
for (const call of WRITE_CALLS) {
  assert(
    !dry.includes(call),
    `dryRun contains no ${call} — --dry-run must be read-only against production`,
  );
}

// resolveStaleSweeps is the one shared helper dryRun calls that CAN write, so
// it must be called in its reporting mode.
assert(
  /resolveStaleSweeps\(true\)/.test(dry),
  "dryRun calls resolveStaleSweeps in report-only mode",
);
{
  const resolve = functionBody(driver, "resolveStaleSweeps");
  assert(resolve.length > 200, "resolveStaleSweeps was extracted");
  const guardIdx = resolve.indexOf("if (dryRun)");
  const writeIdx = resolve.indexOf("updateMany");
  assert(guardIdx >= 0, "resolveStaleSweeps takes a dryRun flag");
  assert(
    writeIdx >= 0 && guardIdx < writeIdx,
    "and returns on it BEFORE its write, not after",
  );
  assert(
    /return stale\.length;/.test(resolve.slice(guardIdx, writeIdx)),
    "the dry-run branch returns rather than falling through",
  );
}

// ---------------------------------------------------------------------------
// 2. the driver is the only `scheduled: true`
// ---------------------------------------------------------------------------

assert(
  /createScrapeRun\([^)]*\{\s*scheduled:\s*true\s*\}\)/.test(driver.replace(/\s+/g, " ")),
  "the driver passes scheduled: true",
);

// Nothing on the request path may originate the flag. scrapeJobRow.ts is
// deliberately NOT in this list: it is the builder, and its `scheduled: true`
// is conditional on a typed input that only an in-process caller can set —
// asserted in src/lib/scrapeRequestBoundary.test.ts, which is where that claim
// belongs.
for (const rel of [
  ["src", "app", "api", "sites", "[id]", "scrape", "route.ts"],
  ["src", "services", "siteService.ts"],
]) {
  const src = strip(readFileSync(join(ROOT, ...rel), "utf8"));
  assert(
    !/scheduled:\s*true/.test(src),
    `${rel.join("/")} never originates scheduled: true`,
  );
}

{
  // And the builder's one occurrence really is conditional, not a constant.
  const builder = strip(readFileSync(join(ROOT, "src", "lib", "scrapeJobRow.ts"), "utf8"));
  const occurrences = builder.split("scheduled: true").length - 1;
  assert(occurrences === 1, `the builder mentions scheduled: true once (found ${occurrences})`);
  assert(
    /input\.scheduled \? \{ scheduled: true \} : \{\}/.test(builder),
    "and only behind `input.scheduled ? … : {}`",
  );
}

// ---------------------------------------------------------------------------
// 3. the loop's safety properties
// ---------------------------------------------------------------------------

assert(
  /instanceof ConflictError/.test(driver) && /skipped_conflict/.test(driver),
  "a ConflictError is recorded as skipped_conflict rather than aborting the sweep",
);
assert(
  /flipped back to IN_PROGRESS/.test(driver),
  "a run returning to IN_PROGRESS after a terminal status is reported as a defect",
);
assert(
  /workerJob\.findFirst/.test(driver),
  "the wait watches the WorkerJob as well as the ScrapeRun",
);
assert(
  !/type:\s*"ANALYSIS"/.test(driver) && !/createAnalysisJob/.test(driver),
  "the sweep never queues ANALYSIS — it would rewrite every hand-built config",
);

{
  // The runtime cap has to be checked before enqueueing, not after, or the cap
  // is one whole site longer than it says.
  const real = functionBody(driver, "realRun");
  assert(real.length > 800, "realRun was extracted");
  const capIdx = real.indexOf("Date.now() > deadline");
  const runIdx = real.indexOf("await runOneSite(");
  assert(capIdx >= 0 && runIdx >= 0 && capIdx < runIdx, "the runtime cap is checked before each site");

  // --- the drain probe runs on the REAL path ---------------------------
  //
  // It existed only inside dryRun once: assessDrain and readQueueState were
  // called nowhere else, so the fleet was enqueued against a worker nobody had
  // checked was alive. A sweep against a dead worker then times out site after
  // site and reports a quiet, successful night — which is precisely the outcome
  // the probe is for. --dry-run having a probe proves nothing about the night.
  assert(
    /probeWorkerDraining\(/.test(real),
    "realRun runs the drain probe — not only dryRun",
  );
  assert(
    /results\.length === 0/.test(real),
    "and it probes with the FIRST site, so nothing else is enqueued until the worker answers",
  );
  assert(
    /BUSY_EVIDENCE_WINDOW_MS/.test(real),
    "the busy wait is bounded at the 20-minute window",
  );

  // The halt must come after the item is recorded, or the night loses the row
  // explaining why it stopped.
  const itemIdx = real.indexOf("scrapeSweepItem.create");
  const haltIdx = real.indexOf("if (result.halt)");
  assert(haltIdx >= 0, "realRun acts on a halt");
  assert(
    itemIdx >= 0 && itemIdx < haltIdx,
    "the sweep item is written before the halt returns",
  );
  assert(
    /haltReason: result\.halt/.test(real),
    "and the sweep row records why it stopped",
  );
}

{
  // The wedged path must take back what it queued. A PENDING job left behind
  // collides with the partial unique index the next time anything queues for
  // that site, and an IN_PROGRESS run blocks the site entirely.
  const one = functionBody(driver, "runOneSite");
  assert(one.length > 800, "runOneSite was extracted");
  const wedgedIdx = one.indexOf('verdict === "wedged"');
  assert(wedgedIdx >= 0, "runOneSite handles a wedged verdict");
  const tail = one.slice(wedgedIdx);
  // The cleanup itself now lives in cancelPendingSiteJob, shared with the
  // per-site timeout and the breaker halt so the three cannot drift apart. Its
  // PENDING/IN_PROGRESS scoping is asserted where it is defined, below.
  assert(
    /cancelPendingSiteJob\(/.test(tail),
    "and takes back the job it queued, through the shared helper",
  );
  assert(
    /halt: "worker not draining"/.test(tail),
    "and halts the sweep with that reason",
  );
}

{
  // The gate's verdict is read only after the WorkerJob is terminal. The
  // dispatcher writes `result` AFTER the handler returns, and the handler closes
  // the ScrapeRun before returning — so reading on the run's terminal status can
  // land in that gap and miss a wouldDemoteTo the gate actually withheld.
  const one = functionBody(driver, "runOneSite");
  const waitJobIdx = one.indexOf("waitForJobTerminal(");
  const withheldIdx = one.indexOf("result.withheld");
  assert(waitJobIdx >= 0, "runOneSite waits for the WorkerJob to be terminal");
  assert(
    withheldIdx >= 0 && waitJobIdx < withheldIdx,
    "before reading what the gate withheld",
  );
  assert(
    !/workerJob\.findFirst\([\s\S]{0,200}result: true/.test(one),
    "and does not read `result` off an un-awaited findFirst",
  );
}

{
  // The counters moved into worker/lib/sweepReport.ts so BOTH close-out paths
  // compute them from the items — the halt path used to write zeros for the
  // three that say what the gate saved. Their semantics are asserted
  // behaviourally in sweepReport.test.ts; what belongs here is that the driver
  // no longer computes them itself and both paths go through one function.
  const real = functionBody(driver, "realRun");
  assert(
    !/const protectedCount/.test(real),
    "realRun no longer computes listingsProtected inline",
  );
  assert(
    !/listingsProtected:/.test(real) && !/wouldHaveDemoted:/.test(real),
    "nor any other counter — they come from computeCounters",
  );

  const closeCalls = real.split("closeSweep({").length - 1;
  assert(
    closeCalls === 2,
    `both the HALTED and COMPLETED paths close through closeSweep (found ${closeCalls})`,
  );

  const close = functionBody(driver, "closeSweep");
  assert(close.length > 500, "closeSweep was extracted");
  assert(/computeCounters\(/.test(close), "closeSweep computes counters from the items");
  assert(/renderSweepReport\(/.test(close), "and renders the report from the same items");
  assert(/logText,/.test(close), "and stores it on the sweep row");
  assert(
    /status === "HALTED"[\s\S]{0,120}haltedAt/.test(close),
    "setting haltedAt only on the halt path",
  );
  assert(
    /\.\.\.counters,/.test(close),
    "the counters are spread in wholesale, so a new one cannot be forgotten on one path",
  );
}

{
  // The report is printed last on both paths, so journalctl ends with it.
  const real = functionBody(driver, "realRun");
  assert(
    (real.split("log(reportText)").length - 1) + (real.split("log(haltedText)").length - 1) === 2,
    "both paths print the rendered report to stdout",
  );
}

assert(
  /wouldSkip/.test(driver),
  "a withheld SKIP is surfaced rather than swallowed",
);

// ---------------------------------------------------------------------------
// 4. the breaker is wired in, and halts cleanly
// ---------------------------------------------------------------------------

{
  const real = functionBody(driver, "realRun");

  assert(/recordOutcome\(/.test(real), "realRun folds each result into the breaker");
  assert(
    /lastSuccessAt: site\.lastSuccessAt/.test(real),
    "and passes the site's PRIOR last success, which is what qualifies a hard failure",
  );
  assert(
    /createBreakerState\(\)/.test(real),
    "the breaker state is per-sweep, so tomorrow starts clean",
  );

  // Order matters twice over: the item that explains the halt must already be
  // written, and the breaker must see the result before it can halt on it.
  const itemIdx = real.indexOf("scrapeSweepItem.create");
  const recordIdx = real.indexOf("recordOutcome(");
  const haltIdx = real.indexOf("if (breaker.halted)");
  assert(haltIdx >= 0, "realRun acts on a halt");
  assert(itemIdx >= 0 && itemIdx < recordIdx, "the sweep item is written before the breaker runs");
  assert(recordIdx < haltIdx, "and the breaker runs before the halt is checked");

  const haltBlock = real.slice(haltIdx, haltIdx + 1600);
  assert(/status: "HALTED"/.test(haltBlock), 'a halt marks the sweep HALTED, not FAILED');
  assert(/haltReason/.test(haltBlock), "and a haltReason");
  // haltedAt is set inside closeSweep, asserted with the rest of that function.
  assert(
    /cancelPendingSiteJob\(/.test(haltBlock),
    "and cleans up the in-flight job through the shared helper",
  );
  assert(
    /left running to finish/.test(haltBlock),
    "recording in the halt reason when a claimed job was left alone",
  );
}

{
  // Only a PENDING job is cancelled. A claimed one belongs to its handler, and
  // closing its run here would be a second writer of terminal state.
  const cancel = functionBody(driver, "cancelPendingSiteJob");
  assert(cancel.length > 400, "cancelPendingSiteJob was extracted");
  assert(
    /status === "IN_PROGRESS"\) return \{ cancelled: false, leftRunning: true \}/.test(cancel),
    "a claimed job is left to its handler rather than raced",
  );
  assert(
    /status: "PENDING" \}/.test(cancel),
    "the job cancel is scoped to PENDING",
  );
  assert(
    /cancelled\.count === 0/.test(cancel),
    "and a job claimed in the gap is detected by the scoped write returning 0",
  );
  assert(
    /status: "IN_PROGRESS" \}/.test(cancel),
    "the run close is scoped to IN_PROGRESS",
  );
  assert(
    /failureCategory: "cancelled"/.test(cancel),
    'a cancelled run is "cancelled", never "other" — it must not feed the breaker',
  );
}

{
  // The per-site timeout used to walk away from its job.
  const one = functionBody(driver, "runOneSite");
  const timeoutIdx = one.indexOf('waited.status === "TIMED_OUT"');
  assert(timeoutIdx >= 0, "runOneSite handles its own timeout");
  assert(
    /cancelPendingSiteJob\(/.test(one.slice(timeoutIdx, timeoutIdx + 600)),
    "and cleans up the job it stopped waiting for",
  );
}

assert(
  /shouldAlertSoftFailures\(/.test(driver),
  "the soft-failure ratio is reported in the summary",
);
assert(
  !/soft[\s\S]{0,80}halt/i.test(functionBody(driver, "realRun").replace(/\/\/.*$/gm, "")),
  "and nothing ties soft failures to a halt",
);


// ---------------------------------------------------------------------------
// 5. the policy sweep (step 8)
// ---------------------------------------------------------------------------

const policyRaw = readFileSync(join(ROOT, "worker", "sweep", "policy.ts"), "utf8");
const policy = strip(policyRaw);

assert(policy.length > 1500, `the policy driver was read (${policy.length} chars)`);

{
  // --dry-run must be read-only here too. It is the thing an operator runs
  // against production to see what 06:00 would do.
  const dry = functionBody(policy, "dryRun");
  assert(dry.length > 300, `policy dryRun was extracted (${dry.length} chars)`);
  assert(dry.includes("selectDuePolicyReviews"), "and is the function that prints the selection");
  for (const call of WRITE_CALLS) {
    assert(!dry.includes(call), `policy dryRun contains no ${call}`);
  }
  assert(
    !/enqueuePolicyReview\(/.test(dry),
    "and queues nothing — enqueuePolicyReview is a write however idempotent it is",
  );
}

{
  const real = functionBody(policy, "realRun");
  assert(real.length > 800, "policy realRun was extracted");
  assert(
    /enqueuePolicyReview\(/.test(real),
    "the real run enqueues through enqueuePolicyReview, which already dedupes",
  );
  assert(
    /selectDuePolicyReviews\(/.test(real),
    "and selects through the shared rule, not its own query",
  );
  assert(
    /renderSweepReport\(/.test(real) && /computeCounters\(/.test(real),
    "and closes through the same renderer as the scrape sweep",
  );
  assert(/kind: "POLICY"/.test(policy), "the sweep row is kind POLICY");
  assert(/phase: "policy"/.test(policy), "and its items are phase policy");
  assert(
    /becameRestricted\(/.test(real),
    "newly_restricted is decided by a transition, not by the resulting status alone",
  );
  assert(
    /status: "RUNNING", kind: "POLICY"/.test(real),
    "the stale-RUNNING rule is scoped to POLICY so it cannot close a scrape sweep",
  );
}

{
  // No breaker on the policy path. A failing policy check is CHECK_FAILED on
  // that site, not evidence about the infrastructure; halting a 25-site pass
  // over three of them would stop the only thing that notices a site has
  // started refusing us.
  assert(
    !/recordOutcome\(/.test(policy) && !/createBreakerState\(/.test(policy),
    "the policy sweep has no breaker",
  );
  assert(!/HALTED/.test(policy), "and nothing halts it");
}

{
  // The policy handler writes only its two columns, so no gate is threaded —
  // but the sweep must not start writing site state itself either.
  assert(
    !/site\.update\(/.test(policy) && !/scheduled: true/.test(policy),
    "the policy sweep never writes a Site row and never sets the scrape gate flag",
  );
}

// The final check MUST stay last. It was once mid-file, with a later block of
// assertions appended after it: they printed FAIL and the suite still exited 0.
if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sweepDriverGuard: --dry-run writes nothing, and only the driver schedules");
