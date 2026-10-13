// Run: npx tsx scripts/seedCityRegions.test.ts
//
// The seed of city.csv's region and kind columns (city-file design item 0,
// commit B). Their towns take their file's region verbatim; the rows they do
// not have follow city-extras.tsv; kind comes from the statistics bureau's
// settlement type; the seed refuses rather than guess a region. Then the
// seeded file itself, and the build's two new maps.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCityCsv, seedCityRows, type PublicFile } from "./seed-city-regions";
import { cityColumn, parseCityCsvTable } from "../worker/lib/cityCsvParse";
import * as places from "../worker/data/il-places";
import { LOCATION_ALIAS, normalizeLocations } from "../worker/lib/locationNormalize";

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
const threw = (f: () => unknown): string | null => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

const cityCsv = ["city", "אזור צפון", "אזור דרום", "עפולה", "דגניה א'", "כפר ויתקין", "אזור תעשיה ברקן", "חיפה", "סאגור", "סאג'ור", "תל חי", "פריסה ארצית", `"ביל""ו"`, ""].join("\n");
const publicFile: PublicFile = {
  generated: "2026-10-12",
  regions: [
    { name: "אזור צפון", towns: [{ name: "עפולה" }, { name: "דגניה א'" }, { name: "חיפה" }, { name: "סאג'ור" }, { name: "כפר ויתקין" }] },
    { name: "אזור דרום", towns: [{ name: "אזור תעשיה ברקן" }, { name: `ביל"ו` }] },
  ],
};
const extrasTsv = [
  "name\taction\tregion\tkind\tkept\tnote",
  "סאגור\tremove\t\t\tסאג'ור\t",
  "תל חי\tkeep\tאזור צפון\ttown\t\t",
  "פריסה ארצית\tkeep\t\tnationwide\t\t",
  "",
].join("\n");
const cbsCsv = [
  "# source line",
  "code,name,district,sub_district,type,council",
  "1,עפולה,הצפון,עפולה,160,",
  "2,דגניה א',הצפון,כנרת,330,",
  "3,כפר ויתקין,המרכז,השרון,320,",
  "4,חיפה,חיפה,חיפה,130,",
  "5,סאג'ור,הצפון,עכו,270,",
  "",
].join("\n");

check("the seed on a fixture", () => {
  const r = seedCityRows({ cityCsv, publicFile, extrasTsv, cbsCsv });
  const by = new Map(r.rows.map((x) => [x.city, x]));
  const row = (c: string) => JSON.stringify(by.get(c) ? [by.get(c)!.region, by.get(c)!.kind] : null);
  assert(row("אזור צפון") === JSON.stringify(["", "region"]), `a region row: kind region, no region (got ${row("אזור צפון")})`);
  assert(row("עפולה") === JSON.stringify(["אזור צפון", "town"]), `their town, their region, an urban type is town (got ${row("עפולה")})`);
  assert(row("דגניה א'") === JSON.stringify(["אזור צפון", "kibbutz"]), `type 330 is kibbutz (got ${row("דגניה א'")})`);
  assert(row("כפר ויתקין") === JSON.stringify(["אזור צפון", "moshav"]), `type 320, the cooperative moshav, is moshav (got ${row("כפר ויתקין")})`);
  assert(row("אזור תעשיה ברקן") === JSON.stringify(["אזור דרום", "zone"]), `an industrial zone is zone, under their region (got ${row("אזור תעשיה ברקן")})`);
  assert(row(`ביל"ו`) === JSON.stringify(["אזור דרום", "town"]), `a row the bureau does not list is town (got ${row(`ביל"ו`)})`);
  assert(r.unlisted.some((u) => u.city === `ביל"ו`), "and it is printed");
  assert(by.get("סאגור") === undefined && r.removed.some((x) => x.city === "סאגור" && x.kept === "סאג'ור"), "a removed extra is gone, with the spelling that stays");
  assert(row("תל חי") === JSON.stringify(["אזור צפון", "town"]), `a kept extra takes the owner's region and kind (got ${row("תל חי")})`);
  assert(row("פריסה ארצית") === JSON.stringify(["", "nationwide"]), `the nationwide row: no region (got ${row("פריסה ארצית")})`);
  assert(JSON.stringify(r.rows.map((x) => x.city)) === JSON.stringify(cityColumn(cityCsv).filter((c) => c !== "סאגור")), "city.csv's order is kept");
});

check("the seed refuses rather than guess", () => {
  const missing = threw(() => seedCityRows({ cityCsv, publicFile: { regions: [...publicFile.regions, { name: "אזור צפון", towns: [{ name: "נוף הגליל" }] }] }, extrasTsv, cbsCsv }));
  assert(!!missing && /נוף הגליל/.test(missing), `a town of theirs that is not ours (got ${missing})`);
  const twice = threw(() => seedCityRows({ cityCsv, publicFile: { regions: [publicFile.regions[0], { name: "אזור דרום", towns: [{ name: "חיפה" }] }] }, extrasTsv, cbsCsv }));
  assert(!!twice && /two regions/.test(twice), `a town under two regions (got ${twice})`);
  const noDecision = threw(() => seedCityRows({ cityCsv, publicFile, extrasTsv: extrasTsv.split("\n").filter((l) => !l.startsWith("תל חי")).join("\n"), cbsCsv }));
  assert(!!noDecision && /תל חי/.test(noDecision) && /no decision/.test(noDecision), `a row of ours with no source for its region (got ${noDecision})`);
});

check("the written file reads back through the parser", () => {
  const r = seedCityRows({ cityCsv, publicFile, extrasTsv, cbsCsv });
  const text = formatCityCsv(r.rows);
  assert(text.startsWith("city,region,kind\n"), "the header");
  assert(text.includes(`"ביל""ו",אזור דרום,town`), "a gershayim name is quoted, its quote doubled");
  const back = parseCityCsvTable(text).rows;
  assert(back.length === r.rows.length && back.every((b, i) => b.city === r.rows[i].city && b.region === r.rows[i].region && b.kind === r.rows[i].kind), "every row round-trips");
});

const root = join(__dirname, "..");
/** v3 merged each duplicate pair into the spelling the population authority lists (H, 2026-10-13). */
const V3_REMOVED: ReadonlyArray<readonly [string, string]> = [
  ["אלון השבות", "אלון שבות"],
  ["נצני עוז", "ניצני עוז"],
  ["רנתיה", "רינתיה"],
  ["חיספין", "חספין"],
];
check("the seeded city.csv", () => {
  const t = parseCityCsvTable(readFileSync(join(root, "CSV files", "city.csv"), "utf8"));
  assert(JSON.stringify(t.header) === JSON.stringify(["city", "region", "kind"]), `the header is city,region,kind (got ${JSON.stringify(t.header)})`);
  assert(t.rows.length === 1355, `1,355 rows: 1,368 less the 9 removed spellings of v2 and the 4 of v3 (got ${t.rows.length})`);
  const by = new Map(t.rows.map((r) => [r.city, r]));
  for (const gone of ['גבעת ניל"י', "סאגור", "שעריי תקווה", "בני-דקלים", "כרמי-קטיף", 'נעמ"ה', 'תלמי ביל"ו', "נוה ירק", 'יד רמב"ם', ...V3_REMOVED.map(([g]) => g)]) {
    assert(!by.has(gone), `${gone} is removed`);
  }
  const is = (c: string, region: string, kind: string) => by.get(c)?.region === region && by.get(c)?.kind === kind;
  // v3: the public site's corrected placements (city-misfilings-2026-10-13.md, plus ברנר).
  assert(by.get("ברנר")?.region === "אזור שפלה", `ברנר: אזור שפלה, as v3 corrects it (got ${by.get("ברנר")?.region})`);
  assert(is("תל חי", "אזור צפון", "town"), "תל חי: אזור צפון, town");
  assert(is("שיזפון", "אזור אילת", "base"), "שיזפון: אזור אילת, base");
  assert(is("גזר", "אזור שפלה", "kibbutz"), "גזר: אזור שפלה, kibbutz");
  assert(is("פריסה ארצית", "", "nationwide"), "פריסה ארצית: nationwide, no region");
  assert(t.rows.filter((r) => r.kind === "region").length === 9, "nine region rows");
});

check("a removed spelling still resolves to the row that stays", () => {
  // A site that still writes the old spelling must land on the kept row, never
  // on Unknown and never on another place (the scanner read תלמי ביל"ו as ביל"ו).
  // A removal already applied by an earlier seed stays on record as "#<line>"
  // (the seed skips it, since the row is gone); it must still resolve.
  const tsv = readFileSync(join(root, "CSV files", "city-extras.tsv"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/^#(?=\S)/, ""))
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("name\t"));
  let n = 0;
  for (const l of tsv) {
    const [name, action, , , kept] = l.split("\t");
    if (action !== "remove") continue;
    n++;
    const got = normalizeLocations(name);
    assert(JSON.stringify(got) === JSON.stringify([kept]), `${name} -> ${kept} (got ${JSON.stringify(got)})`);
  }
  assert(n === 13, `thirteen removed spellings, nine of v2 and four of v3 (got ${n})`);
  for (const [gone, kept] of V3_REMOVED) {
    assert(LOCATION_ALIAS[gone] === kept, `LOCATION_ALIAS maps ${gone} to ${kept} (got ${LOCATION_ALIAS[gone]})`);
    assert(JSON.stringify(normalizeLocations(gone)) === JSON.stringify([kept]), `${gone} -> ${kept} (got ${JSON.stringify(normalizeLocations(gone))})`);
  }
});

check("the build carries the region and the kind", () => {
  const p = places as Record<string, unknown>;
  const region = p.IL_PLACE_REGION as Record<string, string> | undefined;
  const kind = p.IL_PLACE_KIND as Record<string, string> | undefined;
  assert(!!region && !!kind, "worker/data/il-places.ts exports IL_PLACE_REGION and IL_PLACE_KIND");
  if (!region || !kind) return;
  const t = parseCityCsvTable(readFileSync(join(root, "CSV files", "city.csv"), "utf8")).rows;
  assert(t.every((r) => kind[r.city] === r.kind), "IL_PLACE_KIND is the file's kind column");
  assert(t.every((r) => (r.region ? region[r.city] === r.region : !(r.city in region))), "IL_PLACE_REGION is the file's region column");
  assert(JSON.stringify([...places.IL_CANONICAL].sort()) === JSON.stringify(t.map((r) => r.city).sort()), "IL_CANONICAL is still the verbatim city column");
  const build = readFileSync(join(root, "scripts", "build-il-places.ts"), "utf8");
  assert(/const isRegion = kindOf\.get\(row\) === "region";/.test(build), "region detection reads kind, not the prefix");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("seedCityRegions: all assertions passed");
