// Run: npx tsx scripts/lib/jobPager.test.ts
//
// Report fixes 3, item 10 (the developer's 2026-10-21 report, item 4, and
// open question 22): verify-jobids and verify-location-csv page through
// /api/jobs (pageSize 100, page=1,2,... until a short page), print "checked N
// of meta.total" and fail when N is below it; the fix command runs both after
// its guarded run and before the promote, and refuses on either.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- the wiring (read first: these are what HEAD lacks) ------------------------------------------
const batch = readFileSync(join(__dirname, "..", "addsite-batch.ts"), "utf8");
const locGate = readFileSync(join(__dirname, "..", "verify-location-csv.ts"), "utf8");
{
  const jobIds = batch.slice(batch.indexOf("async function verifyJobIdsGate("), batch.indexOf("async function cmdVerifyJobIds("));
  assert(/pageAllJobs[<(]/.test(jobIds), "verify-jobids pages through the jobs list");
  assert(!/pageSize=100`/.test(jobIds) && !/pageSize=100`/.test(locGate), "neither gate reads one page of 100 any more");
  assert(/pageAllJobs[<(]/.test(locGate) && /verifyLocationsGate\(/.test(locGate), "verify-location-csv pages too, through the shared rule");
  const fix = batch.slice(batch.indexOf("async function cmdFix("), batch.indexOf("async function cmdHold("));
  const gates = fix.search(/verifyJobIdsGate\(/);
  const loc = fix.search(/verifyLocationsGate\(/);
  const guarded = fix.indexOf("guarded-run`, { operator }");
  const promote = fix.indexOf("promote ${siteId} to ACTIVE?");
  assert(gates > guarded && loc > guarded, "the fix command runs both gates after its guarded run");
  assert(gates > 0 && loc > 0 && gates < promote && loc < promote, "and before the promote");
  assert(/not promoted; a gate failed/.test(fix), "and refuses when either fails");
}

(async () => {
  const { checkedLine, pageAllJobs } = await import("./jobPager");
  const { verifyLocationsGate } = await import("./locationGate");

  // A stub that answers two pages: 100, then 37.
  const all = Array.from({ length: 137 }, (_, i) => ({ id: `j${i}`, location: "חיפה", locations: ["חיפה"] }));
  const asked: string[] = [];
  const stub = async (page: number, pageSize: number) => {
    asked.push(`${page}/${pageSize}`);
    return { data: all.slice((page - 1) * pageSize, page * pageSize), meta: { total: all.length } };
  };
  const p = await pageAllJobs(stub);
  assert(JSON.stringify(asked) === JSON.stringify(["1/100", "2/100"]), `two pages of 100 asked, until the short one (got ${JSON.stringify(asked)})`);
  assert(p.jobs.length === 137 && p.complete, `every job read (got ${p.jobs.length})`);
  assert(checkedLine(p) === "checked 137 of 137", `the line (got ${checkedLine(p)})`);

  // Exactly 100: a third, empty page ends it.
  const hundred = all.slice(0, 100);
  const e = await pageAllJobs(async (page, size) => ({ data: hundred.slice((page - 1) * size, page * size), meta: { total: 100 } }));
  assert(e.jobs.length === 100 && e.pages === 2 && e.complete, "a full last page is followed by an empty one");

  // Overlapping pages (a list sorted by createdAt alone): fewer than the total, and it says so.
  const overlap = await pageAllJobs(async (page) => ({ data: page === 1 ? all.slice(0, 100) : all.slice(70, 107), meta: { total: 137 } }));
  assert(!overlap.complete && checkedLine(overlap) === "checked 107 of 137", `overlap is counted once and is incomplete (got ${checkedLine(overlap)})`);

  // The location gate on what the pager read: an off-list value fails it, a short read fails it.
  const cities = (await import("./city-csv")).loadCityList();
  const ok = verifyLocationsGate(p, cities);
  assert(ok.ok && /checked 137 of 137/.test(ok.line), `all on city.csv, all read: ok (got ${ok.line})`);
  const short = verifyLocationsGate(overlap, cities);
  assert(!short.ok && /checked 107 of 137/.test(short.line), `a short read is a failure (got ${short.line})`);
  const bad = verifyLocationsGate({ ...p, jobs: [...p.jobs.slice(0, 136), { id: "x", location: "כנות-ים", locations: ["כנות-ים"] }] }, cities);
  assert(!bad.ok && bad.offenders.length === 1, "an off-list value fails it");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("jobPager: both gates read every page and say how many of the total they checked; the fix command runs them");
})().catch((e) => {
  console.error(`FAIL: jobPager test threw — ${(e as Error).message}`);
  process.exit(1);
});
