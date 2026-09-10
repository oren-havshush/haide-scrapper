// Run: npx tsx worker/lib/postTimeoutWrites.test.ts
//
// A MANUAL run whose 15-minute deadline fires mid-pagination.
//
// Once the timeout handler has written this run's terminal status, it owns the
// outcome. Nothing may write a Job or ScrapeRun row afterwards. Today's code
// gets there by luck: extraction keeps paginating until the browser is closed
// underneath it, so whether a late write lands is a race, and when it lands it
// deletes a good set of listings, inserts a partial one, and flips the run to
// COMPLETED over the FAILED the handler just recorded.
//
// Adding a cooperative abort check between pages makes that WORSE on its own —
// breaking out of pagination returns early and falls straight into persistence,
// which is faster and more reliable at doing the wrong thing. The check that
// actually fixes it is the one at the top of the persistence path, and this
// file exists because that distinction is invisible in a diff.
//
// Two halves, and both are needed:
//   1. the rule, driven through the real abortToken module;
//   2. the wiring — that scrape.ts consults it BEFORE it writes.
// Half 1 alone would pass against a scrape.ts that never asks.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beginCommit, createAbortToken, isAborted, requestAbort } from "./abortToken";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// 1. The rule
// ---------------------------------------------------------------------------

type Write = { table: "Job" | "ScrapeRun"; op: string };

/**
 * Replays a manual run: pages, then persists. Every write it is *allowed* to
 * make is recorded, and the deadline fires after `abortAfterPage`. The gates it
 * consults are the real exported ones — this harness decides nothing itself.
 */
function replayManualRun(opts: { pages: number; abortAfterPage: number }): {
  writes: Write[];
  terminalAt: number | null;
} {
  const token = createAbortToken<unknown>();
  const writes: Write[] = [];
  let terminalAt: number | null = null;

  for (let page = 1; page <= opts.pages; page++) {
    // The real check, in the real place: between pages.
    if (isAborted(token)) break;

    if (page === opts.abortAfterPage) {
      // The timeout handler. On a manual run no transaction is open, so it
      // takes the outcome and writes the terminal status itself.
      const req = requestAbort(token, "scrape deadline");
      if (req.outcome === "accepted") {
        writes.push({ table: "ScrapeRun", op: "update:FAILED/timeout" });
        terminalAt = writes.length - 1;
      }
    }
  }

  // The top of the persistence path — the check that does the work.
  if (!isAborted(token)) {
    writes.push({ table: "Job", op: "deleteMany" });
    writes.push({ table: "Job", op: "create" });
    writes.push({ table: "ScrapeRun", op: "update:COMPLETED" });
  }

  return { writes, terminalAt };
}

{
  const { writes, terminalAt } = replayManualRun({ pages: 8, abortAfterPage: 3 });

  assert(terminalAt !== null, "the timeout handler wrote a terminal status");
  assert(
    terminalAt === writes.length - 1,
    `nothing writes after the terminal status — found ${writes.length - 1 - (terminalAt ?? 0)} ` +
      `later write(s): ${writes.slice((terminalAt ?? 0) + 1).map((w) => `${w.table}.${w.op}`).join(", ")}`,
  );
  assert(
    !writes.some((w) => w.table === "Job"),
    "no Job row is touched at all — the previous listings survive the timeout",
  );
  assert(
    !writes.some((w) => w.op === "update:COMPLETED"),
    "the run is not flipped to COMPLETED over the FAILED just recorded",
  );
}

{
  // The control. A run that finishes inside its deadline still persists
  // normally — otherwise the guard above could be "never write anything".
  const { writes, terminalAt } = replayManualRun({ pages: 4, abortAfterPage: 99 });
  assert(terminalAt === null, "no timeout, no terminal status");
  assert(
    writes.filter((w) => w.table === "Job").length === 2,
    "an untimed-out manual run still deletes and inserts as it does today",
  );
  assert(
    writes.some((w) => w.op === "update:COMPLETED"),
    "and still completes its run",
  );
}

{
  // The scheduled counterpart, for contrast: the transaction owns the outcome,
  // so the handler defers instead of writing, and persistence proceeds.
  const token = createAbortToken<string>();
  beginCommit(token, () => Promise.resolve("COMPLETED"));
  assert(
    requestAbort(token, "scrape deadline").outcome === "deferred",
    "a scheduled run mid-commit defers rather than taking the outcome",
  );
  assert(!isAborted(token), "so its persistence is not cancelled halfway");
}

// ---------------------------------------------------------------------------
// 2. The wiring — scrape.ts must ask, and ask first
// ---------------------------------------------------------------------------

const raw = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Index of a marker, or -1. Asserted non-negative before every comparison. */
const at = (needle: string) => src.indexOf(needle);

const persistGuard = at("if (isAborted(runMode.abort)) {");
const manualDelete = at("await prisma.job.deleteMany({ where: { siteId: site.id } });");
const manualInsert = at("await tx.job.create({ data: row });");
const scheduledDelete = at("await tx.job.deleteMany({ where: { siteId: site.id } });");
const scheduledInsert = at("await tx.job.createMany({ data: batch });");

// If a marker moved, this test must fail loudly rather than compare -1 < n and
// silently report success. That is the exact way a guard test stops guarding.
for (const [name, idx] of Object.entries({
  persistGuard,
  manualDelete,
  manualInsert,
  scheduledDelete,
  scheduledInsert,
})) {
  assert(idx >= 0, `marker "${name}" was found in scrape.ts (the test still matches the code)`);
}

assert(
  persistGuard >= 0 && manualDelete >= 0 && persistGuard < manualDelete,
  "the abort check comes BEFORE the manual path deletes listings — this is the whole fix",
);
assert(
  persistGuard >= 0 && manualInsert >= 0 && persistGuard < manualInsert,
  "and before the manual path inserts",
);
assert(
  persistGuard >= 0 && scheduledDelete >= 0 && persistGuard < scheduledDelete,
  "and before the scheduled transaction deletes",
);
assert(
  persistGuard >= 0 && scheduledInsert >= 0 && persistGuard < scheduledInsert,
  "and before the scheduled transaction inserts",
);

{
  // The guard has to return, not merely log. A check that falls through is a
  // comment with extra steps.
  const body = src.slice(persistGuard, persistGuard + 900);
  assert(
    /return\s*\{/.test(body),
    "the abort check returns without writing rather than falling through to persistence",
  );
  assert(
    !/deleteMany|createMany|tx\.job\.create/.test(body.slice(0, body.indexOf("return"))),
    "and it writes nothing on the way out",
  );
}

{
  // Breaking out of pagination is what makes the persistence guard load-bearing
  // — it is why an aborted run reaches persistence early instead of dying when
  // the browser closes. Both must be present; either alone is a bug.
  const paginationChecks = src.split("if (isAborted(abort))").length - 1;
  assert(
    paginationChecks === 2,
    `both pagination loops check the token (found ${paginationChecks})`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("postTimeoutWrites: nothing writes a Job or ScrapeRun row after the deadline");
