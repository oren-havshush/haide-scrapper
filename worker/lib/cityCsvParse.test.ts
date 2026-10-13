// Run: npx tsx worker/lib/cityCsvParse.test.ts
//
// One parser for city.csv (city-file design, commit A). The file is about to
// become city,region,kind; every reader must take the city column by its
// header and nothing else. On today's one-column file nothing changes: the
// city column is exactly the set every reader produced before.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cityColumn, parseCityCsvTable } from "./cityCsvParse";
import { parseCityCsv } from "../../scripts/lib/city-csv";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const root = join(__dirname, "..", "..");
const threeColumns = [
  "city,region,kind",
  "תל אביב-יפו,אזור מרכז,town",
  `"ביל""ו",אזור שפלה,moshav`,
  "אזור מרכז,אזור מרכז,region",
  "",
].join("\n");

check("the city column, by its header, verbatim", () => {
  const got = cityColumn(threeColumns);
  assert(JSON.stringify(got) === JSON.stringify(["תל אביב-יפו", 'ביל"ו', "אזור מרכז"]), `only the city column (got ${JSON.stringify(got)})`);
  const t = parseCityCsvTable(threeColumns);
  assert(JSON.stringify(t.header) === JSON.stringify(["city", "region", "kind"]), `the header (got ${JSON.stringify(t.header)})`);
  assert(t.rows[1]?.kind === "moshav" && t.rows[1]?.city === 'ביל"ו', "a row by header name, with the quoted value unescaped");
});

check("a file with no city column is refused", () => {
  let threw = false;
  try {
    cityColumn("name,region\nא,ב\n");
  } catch {
    threw = true;
  }
  assert(threw, "no city header, no list");
});

check("today's city.csv: the column is what every reader read before", () => {
  const raw = readFileSync(join(root, "CSV files", "city.csv"), "utf8");
  // Today's behaviour, as scripts/lib/city-csv.ts had it: every cell of every
  // line, the header dropped. On a one-column file it is the whole list.
  const before: string[] = [];
  for (const line of raw.replace(new RegExp("^" + String.fromCharCode(0xfeff)), "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const v = line.startsWith('"') ? line.trim().slice(1, -1).replace(/""/g, '"') : line.trim();
    if (v !== "city") before.push(v);
  }
  const now = cityColumn(raw);
  assert(now.length === before.length && now.every((v, i) => v === before[i]), `identical, in order (${now.length} vs ${before.length})`);
  assert(now.length === 1368, `1,368 places (got ${now.length})`);
});

check("scripts/lib/city-csv.ts takes the city column only", () => {
  const list = parseCityCsv(threeColumns);
  const values = [...list.byNormalized.values()];
  assert(!values.includes("town") && !values.includes("moshav") && !values.includes("region"), `no kind is admitted as a city (got ${JSON.stringify(values)})`);
  assert(values.length === 3, `three places (got ${values.length})`);
});

const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*$/gm, "");
check("every other reader goes through the parser", () => {
  for (const f of ["scripts/build-il-places.ts", "scripts/location-normalize-report.ts", "src/lib/locations.test.ts", "scripts/lib/city-csv.ts"]) {
    const src = strip(readFileSync(join(root, f), "utf8"));
    assert(/import \{[^}]*\bcityColumn\b[^}]*\} from "(?:\.\.\/)+worker\/lib\/cityCsvParse"/.test(src), `${f} imports cityColumn from the parser`);
    assert(!/function parseCsvLine/.test(src), `${f} has no CSV parser of its own`);
  }
  const build = strip(readFileSync(join(root, "scripts/build-il-places.ts"), "utf8"));
  assert(!/text\.split\(\/\\r\?\\n\/\)/.test(build), "build-il-places no longer splits the file into lines itself");
  const report = strip(readFileSync(join(root, "scripts/location-normalize-report.ts"), "utf8"));
  assert(!/rows\.shift\(\)/.test(report), "location-normalize-report no longer drops a header line by position");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("cityCsvParse: all assertions passed");
