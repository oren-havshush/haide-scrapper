/**
 * Location gate — every stored location must exist VERBATIM in "CSV files/city.csv".
 *
 * Why this is its own gate: `verify-config`, `addsite-qa` and `verify-jobids` all
 * ignore location *values*, and the worker gazetteer is NOT the same list as the
 * product's city.csv (29 spellings diverge — LRN-LOC-4). A location outside the CSV
 * fragments the dashboard's city filter, and nothing auto-repairs it: the gazetteer
 * and `locationFallback` only fill an EMPTY location, never correct a wrong one.
 *
 * Standing rule (approved 2026-08-09): a job may carry several locations, on the
 * condition that every city is an exact city.csv entry. This checks both `location`
 * and each element of `locations[]`.
 *
 * Every job of the site, page by page (report fixes 3, item 10): it prints
 * "checked N of <meta.total>", and fewer than the total is a failure. The rule
 * lives in scripts/lib/locationGate.ts, which the fix command runs too.
 *
 *   npx tsx scripts/verify-location-csv.ts --site-id <id>
 *   exit 0 = every job read, all values in city.csv · exit 2 = a value is not, or a job went unread
 */
import { readFileSync } from "fs";
import { loadCityList } from "./lib/city-csv";
import { pageAllJobs, siteJobsPageReader } from "./lib/jobPager";
import { verifyLocationsGate, type LocationJob } from "./lib/locationGate";

const BASE = process.env.SCRAP_BASE ?? "https://scrapper.haide-jobs.co.il";
const TOKEN = readFileSync(".claude/scrap-token", "utf8").trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const siteId = arg("site-id");
  if (!siteId) throw new Error("--site-id is required");

  // city.csv parsing lives in scripts/lib/city-csv.ts so this gate and the
  // company-profile capture can never drift onto two different readers.
  const cities = loadCityList();
  const paged = await pageAllJobs<LocationJob>(siteJobsPageReader(BASE, siteId, { Authorization: `Bearer ${TOKEN}` }));
  const gate = verifyLocationsGate(paged, cities);
  console.log(
    JSON.stringify(
      {
        siteId,
        jobs: paged.jobs.length,
        total: paged.total,
        distinctValues: gate.distinctValues,
        multiLocationJobs: gate.multiLocationJobs,
        offenders: gate.offenders,
        ok: gate.ok,
      },
      null,
      2,
    ),
  );
  console.log(`[verify-location-csv] ${gate.line}`);
  if (!gate.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
