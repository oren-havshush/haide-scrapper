/**
 * The location gate's rule (scripts/verify-location-csv.ts): every stored
 * location, `location` and each of `locations[]`, is VERBATIM on
 * "CSV files/city.csv", and every job of the site was read (report fixes 3,
 * item 10: a gate that read 100 of 655 and printed OK checked nothing about
 * the rest). Pure, so the fix command (scripts/addsite-batch.ts cmdFix) runs
 * the same rule after its guarded run.
 */
import { isKnownCity, type CityList } from "./city-csv";
import { checkedLine, type PagedJobs } from "./jobPager";

export interface LocationJob {
  id?: string;
  externalJobId?: string | null;
  location?: string | null;
  locations?: string[] | null;
}

export interface LocationGateResult {
  ok: boolean;
  /** "checked N of T", then the verdict. */
  line: string;
  offenders: Array<{ id: string; value: string }>;
  distinctValues: string[];
  multiLocationJobs: number;
}

export function verifyLocationsGate(paged: PagedJobs<LocationJob>, cities: CityList): LocationGateResult {
  // "Unknown" is the accepted sentinel for a job that states no location.
  const offenders: Array<{ id: string; value: string }> = [];
  const seen = new Set<string>();
  for (const j of paged.jobs) {
    const values: string[] = j.locations?.length ? j.locations : j.location ? [j.location] : [];
    for (const v of values) {
      if (!v || v === "Unknown") continue;
      seen.add(v);
      if (!isKnownCity(v, cities)) offenders.push({ id: j.externalJobId ?? j.id ?? "?", value: v });
    }
  }
  const multi = paged.jobs.filter((j) => (j.locations?.length ?? 0) > 1).length;
  const checked = checkedLine(paged);
  let line: string;
  if (!paged.complete) line = `${checked}: FAIL, not every job was read`;
  else if (offenders.length)
    line =
      `${checked}: FAIL, ${offenders.length} value(s) absent from city.csv — ` +
      offenders.map((o) => `"${o.value}" (${o.id})`).join(", ");
  else line = `${checked}: OK, ${seen.size} distinct value(s), all in city.csv (${multi} multi-location)`;
  return {
    ok: paged.complete && offenders.length === 0,
    line,
    offenders,
    distinctValues: [...seen],
    multiLocationJobs: multi,
  };
}
