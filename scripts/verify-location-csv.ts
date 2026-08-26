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
 *   npx tsx scripts/verify-location-csv.ts --site-id <id>
 *   exit 0 = all values in city.csv · exit 2 = at least one is not
 */
import { readFileSync } from "fs";
import { isKnownCity, loadCityList, type CityList } from "./lib/city-csv";

const BASE = process.env.SCRAP_BASE ?? "https://scrapper.haide-jobs.co.il";
const TOKEN = readFileSync(".claude/scrap-token", "utf8").trim();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * city.csv parsing lives in scripts/lib/city-csv.ts so this gate and the
 * company-profile capture can never drift onto two different readers. See that
 * file for why a naive split(",") is wrong (quoted gershayim names, header row).
 */
function loadCities(): CityList {
  return loadCityList();
}

async function main() {
  const siteId = arg("site-id");
  if (!siteId) throw new Error("--site-id is required");

  const cities = loadCities();
  const res = await fetch(`${BASE}/api/jobs?siteId=${siteId}&pageSize=100`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const jobs = ((await res.json()) as any).data ?? [];

  // "Unknown" is the accepted sentinel for a job that states no location.
  const offenders: { id: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const j of jobs) {
    const values: string[] = j.locations?.length ? j.locations : j.location ? [j.location] : [];
    for (const v of values) {
      if (!v || v === "Unknown") continue;
      seen.add(v);
      if (!isKnownCity(v, cities))
        offenders.push({ id: j.externalJobId ?? j.id, value: v });
    }
  }

  const multi = jobs.filter((j: any) => (j.locations?.length ?? 0) > 1).length;
  console.log(
    JSON.stringify(
      {
        siteId,
        jobs: jobs.length,
        distinctValues: [...seen],
        multiLocationJobs: multi,
        offenders,
        ok: offenders.length === 0,
      },
      null,
      2,
    ),
  );

  if (offenders.length) {
    console.log(
      `[verify-location-csv] FAIL: ${offenders.length} value(s) absent from city.csv — ` +
        offenders.map((o) => `"${o.value}" (${o.id})`).join(", "),
    );
    process.exit(2);
  }
  console.log(
    `[verify-location-csv] OK: ${seen.size} distinct value(s) across ${jobs.length} job(s) ` +
      `all in city.csv (${multi} multi-location)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
