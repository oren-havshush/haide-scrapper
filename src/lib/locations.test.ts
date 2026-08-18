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
import { resolveLocationInput, UNKNOWN_LOCATION } from "./locations";
import { IL_CANONICAL } from "../../worker/data/il-places";

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

console.log("\n# values outside the vocabulary are rejected");
{
  // הגליל normalises to itself and is in neither list — the passthrough case.
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

console.log("\n# IL_CANONICAL still equals CSV files/city.csv");
{
  // Production cannot read the CSV (standalone image), so this test is the only
  // thing keeping the bundled vocabulary honest. city.csv is RFC4180: it has a
  // `city` header and quotes names containing a gershayim — "ביל""ו" is ביל"ו.
  const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ");
  const csv = new Set<string>();
  const raw = readFileSync("CSV files/city.csv", "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    for (const c of cells) {
      const v = norm(c);
      if (v && v !== "city") csv.add(v);
    }
  }
  const gaz = new Set(IL_CANONICAL.map(norm));
  const missingFromCsv = [...gaz].filter((v) => !csv.has(v));
  const missingFromGaz = [...csv].filter((v) => !gaz.has(v));
  assert(missingFromCsv.length === 0,
    `no IL_CANONICAL entry outside city.csv (offenders: ${missingFromCsv.join(", ")})`);
  assert(missingFromGaz.length === 0,
    `no city.csv entry outside IL_CANONICAL (offenders: ${missingFromGaz.join(", ")})`);
  console.log(`  (${gaz.size} gazetteer vs ${csv.size} csv entries)`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
