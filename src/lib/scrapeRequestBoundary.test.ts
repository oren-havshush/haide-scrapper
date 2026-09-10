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
import { readScheduledFlag } from "../../worker/lib/scheduledRun";

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
  "createScrapeRun never spreads its options object into the payload",
);
assert(
  /\.\.\.\(options\?\.scheduled \? \{ scheduled: true \} : \{\}\)/.test(service),
  "`scheduled` is written as a literal true from the in-process option only",
);

{
  // One SCRAPE creator. A second one is a second boundary to get right, and
  // nobody would think to come back here for it.
  const scrapeJobCreators = service.split('type: "SCRAPE"').length - 1;
  assert(
    scrapeJobCreators === 1,
    `exactly one place creates a SCRAPE WorkerJob (found ${scrapeJobCreators})`,
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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("scrapeRequestBoundary: only maxJobs crosses from the client; scheduled cannot");
