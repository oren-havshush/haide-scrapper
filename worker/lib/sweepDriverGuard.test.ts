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
  assert(
    /workerJob\.updateMany/.test(tail) && /scrapeRun\.updateMany/.test(tail),
    "and cancels both the PENDING job and its run",
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
  // listingsProtected counts the wipe that failScrapeRun would have done, not
  // status verdicts. A demotion changes no Job row; conflating them would report
  // protected listings on a night where none were at risk.
  const real = functionBody(driver, "realRun");
  const protIdx = real.indexOf("const protectedCount");
  assert(protIdx >= 0, "realRun computes listingsProtected");
  const expr = real.slice(protIdx, protIdx + 500);
  assert(
    /runStatus === "FAILED"/.test(expr),
    "counting runs that ended FAILED — the state failScrapeRun wipes on",
  );
  assert(
    /jobsBefore > 0/.test(expr),
    "and only where there were listings to lose",
  );
  assert(
    /apply_requires_login/.test(expr),
    "excluding the apply-login skip, which never deletes anything",
  );
  assert(
    !/wouldDemoteTo \|\| r\.wouldPromoteTo/.test(expr),
    "and NOT by demote-or-promote, which touches no Job row",
  );
}

assert(
  /wouldSkip/.test(driver),
  "a withheld SKIP is surfaced rather than swallowed",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sweepDriverGuard: --dry-run writes nothing, and only the driver schedules");
