// Run: npx tsx src/lib/locations.test.ts
//
// Covers the dashboard's location write path (the pure half of
// jobService.updateJobLocation) and the standing multi-location rule:
// a job may name several cities, but every one must be a verbatim entry in
// "CSV files/city.csv".
//
// The last test is the load-bearing one: production validates against the
// bundled IL_CANONICAL because city.csv is not in the standalone image, so the
// two lists must not be allowed to drift apart unnoticed.

import { readFileSync } from "fs";
import { join } from "path";
import {
  isCanonicalLocation,
  isRegionLocation,
  normalizeLocations,
  resolveLocationInput,
  UNKNOWN_LOCATION,
} from "./locations";
import { IL_CANONICAL } from "../../worker/data/il-places";
import { cityColumn } from "../../worker/lib/cityCsvParse";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("  ok:", msg);
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
  );
}
function throws(fn: () => unknown, msg: string) {
  try {
    fn();
    console.error("FAIL:", msg, "— expected a throw, got none");
    failures++;
  } catch {
    console.log("  ok:", msg);
  }
}

console.log("\n# a company HQ city is narrower than a job location");
{
  // The dashboard's HQ-city endpoint (saveCompanyHqCity) applies the same
  // canonicalise-then-gate discipline as resolveLocationInput, plus two
  // constraints a job does not have: exactly one place, and never a region.
  // These assert the pieces that gate is built from.

  // Regions are legal city.csv entries and legal for a JOB — a job really can
  // be "אזור מרכז" — but a company is at an address. Without this a street
  // called "רחוב השפלה" resolved through the alias table to "אזור שפלה" and
  // became the HQ region of a Tel Aviv company.
  assert(isRegionLocation("אזור מרכז"), "אזור מרכז is a region");
  assert(isRegionLocation("אזור הצפון"), "אזור הצפון is a region");
  assert(isRegionLocation("פריסה ארצית"), "פריסה ארצית is nationwide, not a place");
  assert(!isRegionLocation("תל אביב-יפו"), "a real city is not a region");
  assert(!isRegionLocation("אזורים"), "a name merely starting with אזור is not a region");

  // Canonicalise BEFORE gating: a bare membership test would reject every
  // spelling an operator actually types.
  eq(normalizeLocations("תל אביב"), ["תל אביב-יפו"], "תל אביב canonicalises");
  assert(isCanonicalLocation(normalizeLocations("תל אביב")[0]), "and the result is on the list");

  // The gershayim case: ביל"ו is a legal entry, but only squash() unifies the
  // typographic U+05F4 with the ASCII quote, so gating the raw input would
  // reject a city that is on the list.
  const bilu = normalizeLocations("ביל״ו");
  assert(bilu.length === 1 && isCanonicalLocation(bilu[0]), "ביל״ו with a real gershayim resolves");

  // normalizeLocations now drops anything it cannot place in the vocabulary
  // rather than handing the raw string back, so an unknown place yields [].
  eq(normalizeLocations("Sderot Nowhere"), [], "an unknown place yields no value at all");
  assert(
    normalizeLocations("Sderot Nowhere").every(isCanonicalLocation),
    "and nothing off-list can survive the call",
  );

  // An HQ is one place; a comma list must not be accepted as one.
  assert(normalizeLocations("תל אביב, חיפה").length > 1, "a comma list yields several places");
}

console.log("\n# the approved example");
{
  const r = resolveLocationInput("תל אביב-יפו, ירושלים");
  eq(r.primary, "תל אביב-יפו", "primary is the first city");
  eq(r.list, ["תל אביב-יפו", "ירושלים"], "locations keeps both cities");
}

console.log("\n# aliases an operator actually types are canonicalised");
{
  // This is the case the old comma-only split got wrong: it stored ת"א raw,
  // a value absent from city.csv.
  const r = resolveLocationInput('ת"א, ירושלים');
  eq(r.list, ["תל אביב-יפו", "ירושלים"], 'ת"א -> תל אביב-יפו');
  eq(resolveLocationInput("תל אביב").list, ["תל אביב-יפו"], "תל אביב -> תל אביב-יפו");
  eq(resolveLocationInput('כרמיאל, עפולה, גלילות, ב"ש').list,
     ["כרמיאל", "עפולה", "גלילות", "באר שבע"], 'four cities, ב"ש -> באר שבע');
}

console.log("\n# single location still works");
{
  const r = resolveLocationInput("חיפה");
  eq(r.primary, "חיפה", "single primary");
  eq(r.list, ["חיפה"], "single list");
}

console.log("\n# whitespace and sloppy separators");
{
  eq(resolveLocationInput("  תל אביב-יפו ,   ירושלים  ").list,
     ["תל אביב-יפו", "ירושלים"], "trims around the comma");
  eq(resolveLocationInput("חיפה, חיפה").list, ["חיפה"], "de-duplicates");
  eq(resolveLocationInput("חיפה,").list, ["חיפה"], "tolerates a trailing comma");
}

console.log("\n# לוד and רמלה alone resolve to the list's combined entry (owner, 2026-10-02)");
{
  // city.csv has no standalone לוד or רמלה; the one entry is "רמלה לוד". The
  // write path (resolveLocationInput) and the scrape path (normalizeLocations)
  // must agree, and a leading ב ("in") must not lose the city.
  const writeList = (v: string) => {
    try {
      return resolveLocationInput(v).list;
    } catch (e) {
      return `rejected: ${(e as Error).message.slice(0, 40)}`;
    }
  };
  for (const v of ["לוד", "רמלה", "בלוד", "ברמלה"]) {
    eq(writeList(v), ["רמלה לוד"], `write path: ${v} -> רמלה לוד`);
    eq(normalizeLocations(v), ["רמלה לוד"], `scrape path: ${v} -> רמלה לוד`);
  }
  eq(resolveLocationInput("רמלה לוד").list, ["רמלה לוד"], "the combined entry is unchanged (write path)");
  eq(normalizeLocations("רמלה לוד"), ["רמלה לוד"], "the combined entry is unchanged (scrape path)");
  eq(normalizeLocations("רמלה/לוד/מודיעין"), ["רמלה לוד", "מודיעין"], "a slash list with both words collapses to one entry");
}

console.log("\n# values outside the vocabulary are rejected");
{
  // הגליל is in neither list, so it now normalises to nothing at all — the
  // gate below catches it as an empty resolution rather than a raw passthrough.
  throws(() => resolveLocationInput("הגליל"), "rejects הגליל (not in city.csv)");
  throws(() => resolveLocationInput("תל אביב-יפו, הגליל"),
    "rejects the whole edit when one city is unknown");
  throws(() => resolveLocationInput("מטה החברה"), "rejects a non-place label");
  throws(() => resolveLocationInput("   "), "rejects an empty edit");
}

console.log("\n# the Unknown sentinel");
{
  const r = resolveLocationInput(UNKNOWN_LOCATION);
  eq(r.primary, "Unknown", "Unknown is preserved as the primary");
  eq(r.list, [], "Unknown stores an empty locations[]");
}

console.log("\n# every produced value is storable");
{
  for (const input of ['ת"א, ירושלים', "חיפה", 'כרמיאל, ב"ש', "מרכז"]) {
    const r = resolveLocationInput(input);
    assert(r.list.length > 0 && r.primary === r.list[0],
      `${input}: primary === list[0] (Job.location mirrors locations[0])`);
  }
}

console.log("\n# city abbreviations: both quote styles, with and without a leading ב");
{
  // Round 3 (owner, 2026-10-06): an address the company-profile gate read as no
  // city at all — gomobile.co.il's "בית קנדי ראשל''צ" — because only the
  // gershayim spelling was an alias, and never with "in" (ב) in front.
  // '' is two ASCII apostrophes; squash() turns ׳׳ into the same, and ״ into ".
  const abbreviations: [string, string, string][] = [
    ["ראשל", "צ", "ראשון לציון"],
    ["ת", "א", "תל אביב-יפו"],
    ["פ", "ת", "פתח תקווה"],
    ["ב", "ש", "באר שבע"],
    ["כ", "ס", "כפר סבא"],
    ["ר", "ג", "רמת גן"],
  ];
  for (const [head, tail, city] of abbreviations) {
    assert(isCanonicalLocation(city), `${city} is a city.csv entry`);
    for (const quote of ['"', "''", "״", "׳׳"]) {
      for (const prefix of ["", "ב"]) {
        const written = `${prefix}${head}${quote}${tail}`;
        eq(normalizeLocations(written), [city], `${written} -> ${city}`);
      }
    }
  }
  eq(normalizeLocations("בית קנדי ראשל''צ"), ["ראשון לציון"], "gomobile's segment, verbatim, names ראשון לציון");
  eq(normalizeLocations("משרדינו בת''א"), ["תל אביב-יפו"], "inside a longer line, with a leading ב");
  eq(resolveLocationInput("בכ\"ס, ר''ג").list, ["כפר סבא", "רמת גן"], "the dashboard write path takes them too");
  eq(normalizeLocations("בבית"), [], "a ב-word is not an abbreviation");
}

console.log("\n# IL_CANONICAL still equals CSV files/city.csv");
{
  // Production cannot read the CSV (standalone image), so this test is the only
  // thing keeping the bundled vocabulary honest. The city column, by its header
  // (worker/lib/cityCsvParse.ts), quoted names unescaped: "ביל""ו" is ביל"ו.
  const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ");
  const csv = new Set(cityColumn(readFileSync("CSV files/city.csv", "utf8")).map(norm));
  const gaz = new Set(IL_CANONICAL.map(norm));
  const missingFromCsv = [...gaz].filter((v) => !csv.has(v));
  const missingFromGaz = [...csv].filter((v) => !gaz.has(v));
  assert(missingFromCsv.length === 0,
    `no IL_CANONICAL entry outside city.csv (offenders: ${missingFromCsv.join(", ")})`);
  assert(missingFromGaz.length === 0,
    `no city.csv entry outside IL_CANONICAL (offenders: ${missingFromGaz.join(", ")})`);
  console.log(`  (${gaz.size} gazetteer vs ${csv.size} csv entries)`);
}

// The typo and scan steps never produce a near-miss place (owner, 2026-10-12,
// LRN-LOC-18). The cases are data (locationSteps.cases.tsv: step, input, values
// that must appear, values that must not, why), so no Hebrew sits in this file.
{
  console.log("\nnormaliser: no near-miss place from the typo or scan step");
  const rows = readFileSync(join(__dirname, "locationSteps.cases.tsv"), "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(1)
    .map((l) => l.split("\t"));
  assert(rows.length === 16, `the 15 measured cases and the street denylist case are present (got ${rows.length})`);
  for (const [step, input, mustHave, mustNot, why] of rows) {
    const got = normalizeLocations(input);
    for (const v of (mustHave || "").split("|").filter(Boolean))
      assert(got.includes(v), `[${step}] ${why}: keeps ${v} (got ${JSON.stringify(got)})`);
    for (const v of (mustNot || "").split("|").filter(Boolean))
      assert(!got.includes(v), `[${step}] ${why}: never ${v} (got ${JSON.stringify(got)})`);
  }
}

// Report fixes 3, item 6 (2026-10-21, LRN-LOC-28): an industrial zone written
// with its prefix is the zone row, never the town of the same name. gsbgroup
// prints "א.ת כנות" and "אזור התעשייה כנות"; both gave the youth village כנות.
console.log("\n# industrial zones");
{
  for (const [zone, town] of [["אזור תעשיה כנות", "כנות"], ["אזור תעשיה ברקן", "ברקן"]]) {
    const name = town;
    for (const written of [`א.ת ${name}`, `א.ת. ${name}`, `אזור התעשייה ${name}`, `אזור תעשיה ${name}`]) {
      eq(normalizeLocations(written), [zone], `"${written}" is the zone row`);
    }
    eq(normalizeLocations(`רחוב אדום 33, א.ת ${name}`), [zone], `with a street before it`);
    eq(normalizeLocations(name), [town], `the bare name is still the town`);
    assert(!isRegionLocation(zone), `${zone} is not a region (a zone row is a place)`);
  }
  // The kind column decides, not the prefix: every region row is still a region.
  for (const r of ["אזור צפון", "אזור דרום", "אזור מרכז", "אזור שפלה", "אזור ירושלים", "אזור אילת", "אזור השרון", "אזור רמת הגולן", "אזור יהודה ושומרון", "פריסה ארצית"]) {
    assert(isRegionLocation(r), `${r} is still a region`);
  }
  assert(!isRegionLocation("תל אביב-יפו"), "a town is not");
  // A prefix before a name with no zone row gives nothing new.
  assert(!normalizeLocations("א.ת חולון").some((v) => v.startsWith("אזור")), "no zone row for חולון: no zone invented");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
