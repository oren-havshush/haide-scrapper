// Run: npx tsx src/lib/scrapeRequestBoundary.test.ts
//
// `scheduled` is the flag that suppresses every site-mutating write during a
// scrape. The worker trusts it from the WorkerJob row, and by then it is far
// too late to ask where it came from — so the allowlist in the scrape route is
// the actual security boundary, not a tidiness preference.
//
// The failure this guards against is one careless edit: `{ maxJobs }` becoming
// `{ ...body }`. That would let any caller POST `{"scheduled":true}` and get a
// run that skips the activation gate, skips the SKIPPED transition, and never
// clears stale listings on failure — silently, on a site an operator believed
// they had just rescraped by hand.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDetailMode, readScheduledFlag } from "../../worker/lib/scheduledRun";
import { buildScrapeJobRow } from "./scrapeJobRow";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const route = strip(
  readFileSync(join(ROOT, "src", "app", "api", "sites", "[id]", "scrape", "route.ts"), "utf8"),
);
const service = strip(readFileSync(join(ROOT, "src", "services", "siteService.ts"), "utf8"));
// The SCRAPE job row moved into its own builder so the indexed `scrapeRunId`
// column and `payload.scrapeRunId` are written from one argument. The boundary
// claim is unchanged; it just has a new address, and these checks follow it
// rather than being relaxed.
const builder = strip(readFileSync(join(ROOT, "src", "lib", "scrapeJobRow.ts"), "utf8"));

// --- the route reads one field, by name --------------------------------

assert(
  /createScrapeRun\(\s*id\s*,\s*\{\s*maxJobs\s*\}\s*\)/.test(route),
  "the route passes an explicit { maxJobs } literal to createScrapeRun",
);
assert(
  !/\.\.\.\s*body/.test(route),
  "the route never spreads the request body — this is the whole boundary",
);
assert(
  !/scheduled/.test(route),
  "the route does not mention `scheduled` at all, so it cannot forward one",
);
assert(
  /body\?\.maxJobs/.test(route) || /body\.maxJobs/.test(route),
  "and maxJobs is read off the body by name (the test still matches the code)",
);

// --- the service builds the payload by name too -------------------------

assert(
  !/\.\.\.\s*options\b/.test(service),
  "createScrapeRun never spreads its options object into the builder",
);
assert(
  !/\.\.\.\s*input\b/.test(builder),
  "and the builder never spreads its input into the payload either",
);
assert(
  /\.\.\.\(input\.scheduled \? \{ scheduled: true \} : \{\}\)/.test(builder),
  "`scheduled` is written as a literal true from the in-process option only",
);
assert(
  /scheduled\?: boolean/.test(builder),
  "the builder takes `scheduled` as a typed boolean, not as loose passthrough",
);

{
  // One SCRAPE creator. A second one is a second boundary to get right, and
  // nobody would think to come back here for it. It now lives in the builder;
  // the assertion is that there is exactly one, wherever it is.
  const creators =
    service.split('type: "SCRAPE"').length - 1 + (builder.split('type: "SCRAPE"').length - 1);
  assert(
    creators === 1,
    `exactly one place creates a SCRAPE WorkerJob row (found ${creators})`,
  );
}

// --- and the read side agrees -------------------------------------------

{
  // What the route actually produces when a caller tries it on, spelled out as
  // the payload literal createScrapeRun would build from `{ maxJobs }`.
  const clientSent = { maxJobs: 5, scheduled: true, isAdmin: true };
  const maxJobs = typeof clientSent.maxJobs === "number" ? clientSent.maxJobs : undefined;
  const payload = {
    scrapeRunId: "run_abc",
    ...(maxJobs ? { maxJobs } : {}),
    // no `scheduled` — the route has no option to set it
  };

  assert(!("scheduled" in payload), "the client's scheduled key does not survive the allowlist");
  assert(
    !readScheduledFlag(payload),
    "so the worker reads the run as manual and applies its site writes normally",
  );
  assert(payload.maxJobs === 5, "while the one allowlisted field still gets through");
}

assert(
  readScheduledFlag({ scrapeRunId: "run_abc", scheduled: true }),
  "and an in-process sweep payload still reads as scheduled — the guard is not just 'always false'",
);

// --- the detail mode: the same boundary, for the same reason ---------------
//
// "incremental" makes a run publish stored detail text instead of fetching it
// (worker/lib/detailPlan.ts). Only the sweep driver may ask for that, and only
// on a scheduled run; the dashboard always fetches everything.

assert(!/detailMode/.test(route), "the route does not mention detailMode, so it cannot forward one");
assert(
  /detailMode\?: "incremental" \| "full"/.test(builder),
  "the builder takes detailMode as a typed option",
);
assert(
  /\.\.\.\(input\.scheduled && input\.detailMode === "incremental" \? \{ detailMode: "incremental" \} : \{\}\)/.test(builder),
  "and writes it only as a literal, only on a scheduled row",
);
{
  const manual = buildScrapeJobRow({ siteId: "s", scrapeRunId: "r", detailMode: "incremental" });
  assert(!("detailMode" in manual.payload), "a manual row never carries detailMode, even when asked");
  assert(readDetailMode(manual.payload) === "full", "so the worker fetches everything");
  const sweep = buildScrapeJobRow({ siteId: "s", scrapeRunId: "r", scheduled: true, detailMode: "incremental" });
  assert(readDetailMode(sweep.payload) === "incremental", "the sweep's incremental row reads as incremental");
  const saturday = buildScrapeJobRow({ siteId: "s", scrapeRunId: "r", scheduled: true, detailMode: "full" });
  assert(!("detailMode" in saturday.payload), "a full sweep row says nothing — full is the default");
  assert(readDetailMode(saturday.payload) === "full", "and reads as full");
}

// --- the guarded-run request route (step 3, option B) ------------------------------
//
// It asks for a guarded run; the sweep container's own driver runs it. It must
// not become a second way to queue a scrape, and must not forward a scheduled
// flag: it never builds a SCRAPE WorkerJob, never calls createScrapeRun, never
// spreads the body, and reads only `operator` off it, by name.
{
  const guardedPath = join(ROOT, "src", "app", "api", "sites", "[id]", "guarded-run", "route.ts");
  let guarded = "";
  try {
    guarded = strip(readFileSync(guardedPath, "utf8"));
  } catch {
    guarded = "";
  }
  assert(guarded.length > 0, "the guarded-run route exists");
  assert(/requestGuardedRun\(/.test(guarded), "it writes through requestGuardedRun");
  assert(!/scheduled/.test(guarded), "it does not mention `scheduled` at all");
  assert(!/buildScrapeJobRow\(/.test(guarded) && !/createScrapeRun\(/.test(guarded), "it never builds or queues a SCRAPE job");
  assert(!/workerJob/i.test(guarded), "and never touches the WorkerJob table");
  assert(!/\.\.\.\s*body/.test(guarded), "it never spreads the request body");
  assert(/body\?\.operator/.test(guarded), "and reads operator off the body by name");
  let guardedService = "";
  try {
    guardedService = strip(readFileSync(join(ROOT, "src", "services", "guardedRunService.ts"), "utf8"));
  } catch {
    guardedService = "";
  }
  assert(guardedService.length > 0, "its service exists");
  assert(/planGuardedRunRequest\(/.test(guardedService), "which is gated by planGuardedRunRequest before it writes");
  assert(
    !/scheduled/.test(guardedService) && !/buildScrapeJobRow\(|createScrapeRun\(/.test(guardedService) && !/workerJob/i.test(guardedService),
    "and the service writes only GuardedRunRequest rows: no SCRAPE job, no scheduled flag",
  );
  // The scrape route is unchanged by all this: still exactly the checks above.
  assert(!/guarded/i.test(route), "the scrape route knows nothing of guarded runs");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("scrapeRequestBoundary: only maxJobs crosses from the client; scheduled cannot");
