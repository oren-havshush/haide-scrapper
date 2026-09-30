// Run: npx tsx src/lib/firstDatesWiring.test.ts
//
// Step A (owner, 2026-09-30): the "first" dates. Source-level, like
// autoFixWiring.test.ts, because the writes need a live database.
//   - Site.firstActiveAt: set on the first move to ACTIVE, by every path that
//     makes a site ACTIVE, and never overwritten;
//   - Site.firstScrapedAt: set on the first completed scrape, never overwritten;
//   - Job.firstSeenAt: carried from the previous row with the same identity;
//   - the backfill applies the reviewed list only, and only where null;
//   - the dashboard shows them; the nightly report is unchanged.

import { existsSync, readFileSync } from "node:fs";
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
const read = (p: string) => (existsSync(join(ROOT, p)) ? strip(readFileSync(join(ROOT, p), "utf8")) : "");
const flat = (s: string) => s.replace(/\s+/g, " ");
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
  if (start < 0) return "";
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end);
}

// --- the set-once helpers ----------------------------------------------------------
const helpers = flat(read("src/lib/firstDates.ts"));
assert(helpers.length > 0, "src/lib/firstDates.ts exists");
assert(
  /updateMany\(\{ where: \{ id: siteId, firstActiveAt: null \}, data: \{ firstActiveAt: at \} \}\)/.test(helpers),
  "markFirstActive writes only where firstActiveAt is still null — never overwritten",
);
assert(
  /updateMany\(\{ where: \{ id: siteId, firstScrapedAt: null \}, data: \{ firstScrapedAt: at \} \}\)/.test(helpers),
  "markFirstScraped writes only where firstScrapedAt is still null",
);

// --- every path to ACTIVE marks it -------------------------------------------------
{
  const svc = fnBody(read("src/services/siteService.ts"), "updateSiteStatus");
  assert(/if \(newStatus === "ACTIVE"\) \{?\s*await markFirstActive\(siteId,/.test(svc), "updateSiteStatus marks the first ACTIVE");
  const gate = fnBody(read("worker/jobs/scrape.ts"), "applyActivationGate");
  const update = gate.indexOf("prisma.site.update(");
  const mark = gate.indexOf("markFirstActive(");
  assert(mark > update && update > 0, "the worker's activation gate marks it after writing ACTIVE");
  assert(/if \(gate\.status === "ACTIVE"\) \{?\s*await markFirstActive\(/.test(gate), "only when the gate wrote ACTIVE");
}

// --- the first completed scrape --------------------------------------------------------
{
  const exec = fnBody(read("worker/jobs/scrape.ts"), "executeScrape");
  const persisted = exec.lastIndexOf("Saved chunk:");
  const mark = exec.indexOf("markFirstScraped(");
  const gate = exec.indexOf('label: "post-persist"');
  assert(mark > persisted && persisted > 0, "firstScrapedAt is marked after both paths have written every row");
  assert(mark < gate, "and before the post-persist gate");
  const src = read("worker/jobs/scrape.ts");
  assert(!/firstActiveAt:|firstScrapedAt:/.test(src), "scrape.ts writes neither column itself — only through the set-once helpers");
}

// --- Job.firstSeenAt ------------------------------------------------------------------
{
  const scrape = read("worker/jobs/scrape.ts");
  const build = fnBody(scrape, "buildJobRows");
  assert(/firstSeenAt: firstSeenFor\(previous, args\.seenAt\)/.test(build), "buildJobRows carries firstSeenAt from the previous row");
  const prev = fnBody(scrape, "readPreviousLocations");
  assert(/firstSeenAt: true/.test(prev), "the previous rows are read with their firstSeenAt");
  assert(/firstSeenAt: r\.firstSeenAt/.test(prev), "and carry it into the lookup");
}

// --- the backfill tool -------------------------------------------------------------------
{
  const tool = flat(read("worker/tools/backfillFirstDates.ts"));
  assert(tool.length > 0, "worker/tools/backfillFirstDates.ts exists (scripts/ is not in the worker image)");
  assert(tool.includes("parseFirstDatesList("), "it applies the reviewed list through the parser");
  assert(/process\.argv\.includes\("--apply"\)/.test(tool), "and writes only with --apply");
  assert(/firstActiveAt: null/.test(tool) && /firstScrapedAt: null/.test(tool), "only where the column is still null");
}

// --- dashboard shown; report unchanged ----------------------------------------------------
{
  const sites = readFileSync(join(ROOT, "src/components/sites/SitesTable.tsx"), "utf8");
  assert(sites.includes("First scraped") && sites.includes("Last scraped"), "the sites table shows first and last scraped");
  const jobs = readFileSync(join(ROOT, "src/components/jobs/JobsTable.tsx"), "utf8");
  assert(jobs.includes("First seen") && jobs.includes("Last seen"), "the jobs table shows first and last seen");
  const report = read("worker/lib/sweepReport.ts");
  assert(!/firstSeen|firstScraped|firstActive/.test(report), "the nightly report is unchanged");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("firstDatesWiring: set once, carried forward, backfilled from the reviewed list, shown on the dashboard");
