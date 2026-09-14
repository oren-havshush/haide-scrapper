// Run: npx tsx src/lib/scrapeJobRow.test.ts
//
// The ScrapeRun link is written to two places that must hold the same id:
// the indexed `scrapeRunId` column, and `payload.scrapeRunId`.
//
// Losing the column is the silent one, and it nearly shipped. The sweep
// migration backfills the column from the payload, so a build where
// createScrapeRun writes only the payload still LOOKS right — the 517 existing
// rows are linked, the reaper works when you test it against them, and every
// job created from that point on has a NULL column. The reaper joins on the
// column, so those runs never match the structural rule ("the owning WorkerJob
// is already terminal") and instead wait out the one-hour age backstop. That is
// R7 defeated for exactly the runs the nightly creates, and nothing fails.
//
// So: a behavioural test that the row carries both, and source checks that the
// two call sites actually go through the builder.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScrapeJobRow } from "./scrapeJobRow";
import { readScheduledFlag } from "../../worker/lib/scheduledRun";
import { readScrapeRunId } from "../../worker/lib/failureCleanup";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- both places carry the id, and it is the same id --------------------

{
  const row = buildScrapeJobRow({ siteId: "site_1", scrapeRunId: "run_abc" });

  assert(
    row.scrapeRunId === "run_abc",
    "the indexed column is populated — this is what the reaper joins on",
  );
  assert(
    (row.payload as { scrapeRunId?: string }).scrapeRunId === "run_abc",
    "the payload key is populated — this is what the worker reads",
  );
  assert(
    row.scrapeRunId === (row.payload as { scrapeRunId?: string }).scrapeRunId,
    "and they are the same id; two links to different runs would be worse than one",
  );

  // The worker's own reader, against the row the service actually writes.
  assert(
    readScrapeRunId(row.payload) === "run_abc",
    "worker/lib/failureCleanup.readScrapeRunId still finds it — the payload shape is unchanged",
  );

  assert(row.type === "SCRAPE", "it is a SCRAPE job");
  assert(row.status === "PENDING", "queued, not running");
  assert(row.siteId === "site_1", "on the right site");
}

// --- the optional fields ------------------------------------------------

{
  const plain = buildScrapeJobRow({ siteId: "s", scrapeRunId: "r" });
  assert(!("maxJobs" in plain.payload), "no maxJobs key when none was asked for");
  assert(
    !("scheduled" in plain.payload),
    "and no scheduled key at all — absent is what makes every queued job read as manual",
  );
  assert(!readScheduledFlag(plain.payload), "so the worker treats it as manual");
}

{
  const scheduled = buildScrapeJobRow({
    siteId: "s",
    scrapeRunId: "r",
    maxJobs: 5,
    scheduled: true,
  });
  assert(
    (scheduled.payload as { maxJobs?: number }).maxJobs === 5,
    "maxJobs rides through when given",
  );
  assert(
    readScheduledFlag(scheduled.payload),
    "a sweep job reads as scheduled — the flag still reaches the gate",
  );
  assert(
    scheduled.scrapeRunId === "r",
    "and the column is populated on a scheduled job too — the nightly's own runs are the ones R7 is for",
  );
}

{
  // maxJobs: 0 is not a limit of zero, it is no limit. Matches the route, which
  // only accepts `> 0`.
  const zero = buildScrapeJobRow({ siteId: "s", scrapeRunId: "r", maxJobs: 0 });
  assert(!("maxJobs" in zero.payload), "maxJobs 0 is omitted rather than written as a cap");
}

// --- the call sites go through the builder ------------------------------

const ROOT = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const service = strip(readFileSync(join(ROOT, "src", "services", "siteService.ts"), "utf8"));
const reaper = strip(readFileSync(join(ROOT, "src", "services", "scrapeRunService.ts"), "utf8"));

assert(
  /workerJob\.create\(\{\s*data:\s*buildScrapeJobRow\(/.test(service),
  "createScrapeRun builds its row with buildScrapeJobRow rather than an inline literal",
);
assert(
  !/type:\s*"SCRAPE"/.test(service),
  "and there is no hand-rolled SCRAPE job row left in the service to drift from it",
);

// --- the reaper matches on the payload too ------------------------------

assert(
  /"scrapeRunId" IS NULL/.test(reaper) && /payload->>'scrapeRunId'/.test(reaper),
  "the reaper falls back to the payload when the column is NULL, so a row that " +
    "missed the column is still matched structurally rather than by age",
);
assert(
  /scrapeRunId: \{ in: runIds \}/.test(reaper),
  "while the indexed column stays the fast path",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("scrapeJobRow: the run link is written to both the column and the payload");
