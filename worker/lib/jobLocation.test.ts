// Run: npx tsx worker/lib/jobLocation.test.ts
//
// One property, in two halves:
//
//   a job that stops printing its city keeps the city it published,
//   and a job that never had a clean one does NOT inherit anything.
//
// Persistence is delete-all-then-insert, so the location of every row is
// re-decided from scratch on every scrape. Before this rule, a listing page
// that dropped its location column for one job moved that job to the company
// HQ — `locationFallback` — and the public jobs site published an address the
// employer had not stated for it. That is a wrong value replacing a right one,
// which is the failure this repo exists to avoid.
//
// Fixtures are real stored rows: nirlat (cmp01cdsd001a01ph74xluh8r) and
// tikshoov (cmu5mleu7000c01p950bo7eqx), read from /api/jobs on 2026-09-23.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canCarryForward, resolveJobLocation, type JobLocationInput } from "./jobLocation";
import { isCanonicalLocation } from "./locationNormalize";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const base: JobLocationInput = {
  overrideLocation: null,
  overrideLocations: null,
  extracted: null,
  previous: null,
  fallback: null,
};
const resolve = (patch: Partial<JobLocationInput>) => resolveJobLocation({ ...base, ...patch });

// ---------------------------------------------------------------------------
console.log("# the precedence that already held");
// ---------------------------------------------------------------------------
{
  // nirlat JB-802, "יצרן.ית צבע - ניר עוז": the page prints the city.
  eq(
    resolve({ extracted: "ניר עוז", fallback: "נתניה" }),
    { location: "ניר עוז", locations: ["ניר עוז"], source: "extracted" },
    "an extracted city beats the site fallback",
  );

  // A manual override is a human's assertion and outranks everything.
  eq(
    resolve({ overrideLocation: "חיפה", extracted: "ניר עוז", fallback: "נתניה" }),
    { location: "חיפה", locations: ["חיפה"], source: "override" },
    "a manual override beats an extracted city",
  );
  eq(
    resolve({
      overrideLocation: "באר שבע",
      overrideLocations: ["באר שבע", "ניר עוז"],
      previous: { location: "חיפה", locations: ["חיפה"] },
    }),
    { location: "באר שבע", locations: ["באר שבע", "ניר עוז"], source: "override" },
    "a multi-place override keeps its whole list",
  );

  // xnes (cmq9ivpg0002u01lcp5z0huih) before 2026-09-23 injected the literal
  // "Unknown" precisely so the fallback would NOT fire (LRN-LOC-7). That is the
  // config asserting "this job states no place", not the scrape finding nothing,
  // and it must keep suppressing everything below it.
  eq(
    resolve({ extracted: "Unknown", fallback: "בני ברק" }),
    { location: "Unknown", locations: [], source: "extracted" },
    'an injected "Unknown" still suppresses the fallback (LRN-LOC-7)',
  );

  eq(
    resolve({ fallback: "בני ברק" }),
    { location: "בני ברק", locations: ["בני ברק"], source: "fallback" },
    "with nothing extracted and nothing stored, the site fallback applies",
  );
  eq(
    resolve({}),
    { location: "Unknown", locations: [], source: "unknown" },
    "and with neither, the row is honestly Unknown",
  );
}

// ---------------------------------------------------------------------------
console.log("# NEW — a previously published city outranks the site fallback");
// ---------------------------------------------------------------------------
{
  // The case itself. nirlat JB-802 published ניר עוז; tonight the listing page
  // prints no location for it. The company HQ is נתניה. Before this rule the
  // row moved to נתניה — a place this job is not.
  eq(
    resolve({
      extracted: null,
      previous: { location: "ניר עוז", locations: ["ניר עוז"] },
      fallback: "נתניה",
    }),
    { location: "ניר עוז", locations: ["ניר עוז"], source: "previous" },
    "a job that stops printing its city keeps the city it published",
  );

  // nirlat JB-812 really is in two places: "לאתר החברה בבאר שבע/ניר עוז".
  // The whole list survives, not just the primary.
  eq(
    resolve({
      previous: { location: "באר שבע", locations: ["באר שבע", "ניר עוז"] },
      fallback: "נתניה",
    }),
    { location: "באר שבע", locations: ["באר שבע", "ניר עוז"], source: "previous" },
    "a multi-place row carries its whole list forward",
  );

  // With no fallback configured at all, the carry-forward is the difference
  // between the published city and "Unknown".
  eq(
    resolve({ previous: { location: "חיפה", locations: ["חיפה"] } }),
    { location: "חיפה", locations: ["חיפה"], source: "previous" },
    "and with no fallback, it is the difference between the city and Unknown",
  );

  // Order, stated as three separate facts so a later edit cannot quietly
  // reshuffle them.
  eq(
    resolve({
      overrideLocation: "ירושלים",
      previous: { location: "חיפה", locations: ["חיפה"] },
      fallback: "נתניה",
    }).source,
    "override",
    "a manual override still outranks the carried-forward value",
  );
  eq(
    resolve({
      extracted: "אשדוד",
      previous: { location: "חיפה", locations: ["חיפה"] },
      fallback: "נתניה",
    }).source,
    "extracted",
    "and tonight's extracted value still outranks it",
  );
  eq(
    resolve({ previous: { location: "חיפה", locations: ["חיפה"] }, fallback: "נתניה" }).source,
    "previous",
    "but it outranks the site fallback",
  );
}

// ---------------------------------------------------------------------------
console.log("# NEW — Unknown never carries forward, and neither does an off-list value");
// ---------------------------------------------------------------------------
{
  // tikshoov 4082/4913/4983 are stored "Unknown" with an empty list, by the
  // owner's decision: their ads name no place. Carrying that forward as a
  // *value* would freeze the row against a future scrape that finds the city,
  // and it is not a place in any case.
  assert(
    !isCanonicalLocation("Unknown"),
    '"Unknown" is not on city.csv, which is why the rule needs no special case for it',
  );
  eq(
    resolve({ previous: { location: "Unknown", locations: [] }, fallback: "בני ברק" }),
    { location: "בני ברק", locations: ["בני ברק"], source: "fallback" },
    "a stored Unknown does not carry forward — the fallback still applies",
  );
  eq(
    resolve({ previous: { location: "Unknown", locations: [] } }),
    { location: "Unknown", locations: [], source: "unknown" },
    "and with no fallback the row is Unknown by the last rule, not by inheritance",
  );

  // Rows written before the city gate (590f187) can hold anything. These seven
  // are what tikshoov actually served. None may come back.
  const offList = [
    "תקשוב מהבית",
    "צ'ק פוסט",
    "הכשרה בקדמת גליל",
    "באזור תעשייה קדמת גליל",
    "לוד (מול תחנת הרכבת",
    "עבודה מהבית (ההכשרה מתקיימת פרונטלית בתחנה המרכזית ירושלים).",
    "Sderot Nowhere",
  ];
  for (const bad of offList) {
    assert(
      !canCarryForward({ location: bad, locations: [bad] }),
      `an off-list stored value is not carried forward: ${JSON.stringify(bad)}`,
    );
    eq(
      resolve({ previous: { location: bad, locations: [bad] }, fallback: "נתניה" }).source,
      "fallback",
      `and the row falls through to the fallback instead: ${JSON.stringify(bad)}`,
    );
  }

  // Half-clean is not clean. This is the shape that looks repaired and is not.
  assert(
    !canCarryForward({ location: "חיפה", locations: ["חיפה", "צ'ק פוסט"] }),
    "a list with one off-list entry carries nothing — not its good half",
  );
  assert(
    !canCarryForward({ location: "חיפה", locations: ["נתניה", "חיפה"] }),
    "nor does a list whose first entry is not the primary value",
  );
  assert(
    canCarryForward({ location: "חיפה", locations: [] }),
    "a bare canonical primary with no list is still clean",
  );
  assert(!canCarryForward(null), "and a job with no previous row carries nothing");
}

// ---------------------------------------------------------------------------
console.log("# the gate still holds: nothing off-list leaves this function");
// ---------------------------------------------------------------------------
{
  // Whatever the inputs, a value that is neither canonical nor the "Unknown"
  // sentinel must not appear in `locations` — the column the dashboard's city
  // filter reads.
  const inputs: Array<Partial<JobLocationInput>> = [
    { extracted: "צ'ק פוסט" },
    { extracted: "צ'ק פוסט", previous: { location: "חיפה", locations: ["חיפה"] } },
    { previous: { location: "צ'ק פוסט", locations: ["צ'ק פוסט"] }, fallback: "חיפה" },
    { fallback: "קדמת גליל" },
    { overrideLocation: "חיפה", previous: { location: "צ'ק פוסט", locations: ["צ'ק פוסט"] } },
  ];
  for (const patch of inputs) {
    const out = resolve(patch);
    const bad = out.locations.filter((v) => !isCanonicalLocation(v));
    eq(bad, [], `no off-list value in locations[] for ${JSON.stringify(patch)}`);
  }
}

// ---------------------------------------------------------------------------
console.log("# the wiring — scrape.ts must actually ask this module");
// ---------------------------------------------------------------------------
{
  // A perfect precedence protects nothing if buildJobRows keeps its own copy,
  // and the rule is unreachable if nobody reads the previous rows. Both need a
  // database to exercise, so they are checked as source, the way
  // scheduledWriteGuard.test.ts checks the site-write gate.
  const raw = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  assert(src.includes("resolveJobLocation({"), "buildJobRows calls resolveJobLocation");
  assert(
    src.includes("previousLocations,") && src.includes("readPreviousLocations(site.id)"),
    "and the previous rows are read and handed to it",
  );
  // Read BEFORE anything deletes them, or the map is always empty.
  const read = src.indexOf("await readPreviousLocations(site.id)");
  const firstDelete = Math.min(
    ...["tx.job.deleteMany(", "prisma.job.deleteMany("]
      .map((n) => src.indexOf(n))
      .filter((i) => i >= 0),
  );
  // Math.min of nothing is Infinity, which would make the ordering assertion
  // below pass while finding no delete at all. Say so first.
  assert(Number.isFinite(firstDelete), "the listing deletes were found, so the ordering check is real");
  assert(read >= 0 && read < firstDelete, "and read before the first delete, not after it");

  // The old inline precedence is gone — not merely unused.
  assert(
    !/overriddenLocation \?\? extractedLocation/.test(src),
    "the inline precedence chain is gone from buildJobRows",
  );
  // The whole point of the module: exactly one place decides this.
  const calls = src.split("resolveJobLocation(").length - 1;
  assert(calls === 1, `resolveJobLocation has exactly one call site in scrape.ts (found ${calls})`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\njobLocation: a published city survives a scrape that stops printing it");
