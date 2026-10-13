// Run: npx tsx worker/lib/locationMap.test.ts
//
// Maof's detail read (city-file design, commit D): `all: true` reads every
// match of a field's selector, joined with " | "; the site's locationMap turns
// each area label into a city.csv row (or nothing) before the normaliser sees
// it; an unknown label is dropped and counted, never scanned for a city. The
// targets are checked when the config is saved.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { applyLocationMap, joinAllMatches, LOCATION_FROM_MAP, readAllMatches, readLocationMap, unmappedLabelWarnings } from "./locationMap";
import { normalizeJobRecord } from "./normalizer";
import { updateSiteConfigSchema } from "../../src/lib/validators";

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

// The owner's table for Maof (2026-10-13), label -> city.csv row or none.
const MAOF: Record<string, string | null> = {
  "כל הארץ": null,
  "אשדוד והסביבה": "אשדוד",
  "עמקים וטבריה": "אזור צפון",
  "כרמיאל והסביבה": "כרמיאל",
  "אילת": "אילת",
  "ירושלים והסביבה": "אזור ירושלים",
  "באר שבע": "באר שבע",
  "קרית שמונה והצפון": "אזור צפון",
  "השרון": "אזור השרון",
  "חיפה והסביבה": "חיפה",
  "תל אביב והסביבה": "אזור מרכז",
  "קריות": "אזור צפון",
  'עבודה בחו"ל': null,
  "שפלה": "אזור שפלה",
};

check("all: true joins every match, trimmed", () => {
  assert(joinAllMatches(["קריות ", " עמקים וטבריה ", "", null]) === "קריות | עמקים וטבריה", `joined (got ${JSON.stringify(joinAllMatches(["קריות ", " עמקים וטבריה "]))})`);
  assert(joinAllMatches([]) === "", "no match, no value");
});

check("the map, label by label", () => {
  const r236765 = applyLocationMap("קריות | עמקים וטבריה", MAOF);
  assert(r236765.value === "אזור צפון" && r236765.unmapped.length === 0, `236765: both areas are אזור צפון, once (got ${JSON.stringify(r236765)})`);
  const two = applyLocationMap("אשדוד והסביבה | השרון", MAOF);
  assert(two.value === "אשדוד, אזור השרון", `two areas, two places, in order (got ${JSON.stringify(two)})`);
  const none = applyLocationMap("כל הארץ", MAOF);
  assert(none.value === "" && none.unmapped.length === 0, `a label mapped to none gives nothing, and is not unmapped (got ${JSON.stringify(none)})`);
  const unknown = applyLocationMap("גליל מערבי | חיפה והסביבה", MAOF);
  assert(unknown.value === "חיפה" && JSON.stringify(unknown.unmapped) === JSON.stringify(["גליל מערבי"]), `an unknown label is dropped and returned (got ${JSON.stringify(unknown)})`);
  assert(applyLocationMap("", MAOF).value === "", "an empty field gives nothing");
  assert(
    JSON.stringify(unmappedLabelWarnings(new Map([["גליל מערבי", 3]]))) === JSON.stringify(["location_label_unmapped: גליל מערבי (3 job(s))"]),
    "the run warning",
  );
});

check("the stored key", () => {
  const map = readLocationMap({ _meta: { locationMap: MAOF } });
  assert(!!map && map["קריות"] === "אזור צפון" && map["כל הארץ"] === null, "read from _meta.locationMap");
  assert(readLocationMap({ _meta: {} }) === null && readLocationMap(null) === null, "absent is null");
});

check("a mapped location is final: no scan of the ad for a place", () => {
  const rec = normalizeJobRecord(
    { title: "מהנדס/ת", location: "", [LOCATION_FROM_MAP]: "1", description: "לחברה מובילה בטבריה דרוש/ה מהנדס/ת. מיקום: טבריה" },
    { at: new Date("2026-10-13T00:00:00Z") },
  );
  assert(!rec.location, `the description's טבריה is not taken (got ${JSON.stringify(rec.location)})`);
  const unmarked = normalizeJobRecord(
    { title: "מהנדס/ת", location: "", description: "לחברה מובילה בטבריה דרוש/ה מהנדס/ת. מיקום: טבריה" },
    { at: new Date("2026-10-13T00:00:00Z") },
  );
  assert(!!unmarked.location, "without the map the fallbacks still run, as today");
  const mapped = normalizeJobRecord({ title: "מהנדס/ת", location: "אזור צפון", [LOCATION_FROM_MAP]: "1" }, { at: new Date("2026-10-13T00:00:00Z") });
  assert(mapped.location === "אזור צפון", `a mapped value passes through (got ${JSON.stringify(mapped.location)})`);
});

check("the config: locationMap and all", () => {
  const base = { fieldMappings: {}, pageFlow: [], formCapture: null };
  const ok = (extra: Record<string, unknown>) => updateSiteConfigSchema.safeParse({ ...base, ...extra });
  assert(ok({ locationMap: MAOF }).success, "the owner's Maof table is accepted");
  const offList = ok({ locationMap: { "טבריה והסביבה": "טבריה והסביבה" } });
  assert(!offList.success && /locationMap/.test(JSON.stringify(offList.error?.issues ?? [])), "a target not on city.csv is refused");
  const zone = ok({ locationMap: { "ברקן": "אזור תעשיה ברקן" } });
  assert(!zone.success, "a target named as a region must be a region row (אזור תעשיה ברקן is a zone)");
  assert(!ok({ locationMap: { "קריות": 7 } }).success, "a target is a string or null");
  assert(ok({ fieldMappings: { location: { selector: ".x", all: true } } }).success, "all: true on a field is accepted");
  assert(!ok({ fieldMappings: { location: { selector: ".x", all: "yes" } } }).success, "all must be a boolean");
});

check("the scrape wires it", () => {
  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8").replace(/^\s*\/\/[^\n]*$/gm, "");
  assert(/mapping\.all === true[\s\S]{0,200}readAllMatches\(page, mapping\.selector, fieldName, mapping\.extractAttr\)/.test(src), "a detail field with all: true reads every match");
  assert(/applyLocationMap\([^)]*\)[\s\S]{0,1500}normalizeJobRecord\(/.test(src), "the map is applied before the normaliser");
  assert(/scrapeWarnings\.push\(\.\.\.unmappedLabelWarnings\(/.test(src), "unmapped labels reach the run's warnings");
  const svc = readFileSync(join(__dirname, "../../src/services/siteService.ts"), "utf8");
  assert(/locationMap: config\.locationMap \?\? null/.test(svc), "saveSiteConfig stores locationMap under _meta");
});

// 236765's area field, read by the selector the developer would set.
(async () => {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(readFileSync(join(__dirname, "fixtures", "maof-236765-area.html"), "utf8"));
    const got = await readAllMatches(page, ".position-data:has(.fa-map-marker) .job-group-item", "location");
    assert(got === "קריות | עמקים וטבריה", `236765 reads both areas (got ${JSON.stringify(got)})`);
    const viaMap = applyLocationMap(got, MAOF);
    assert(viaMap.value === "אזור צפון", `and maps to אזור צפון (got ${JSON.stringify(viaMap)})`);
    await page.setContent("<div class='position-data'><h3><i class='fas fa-map-marker'></i> איזור:</h3><div> </div></div>");
    assert((await readAllMatches(page, ".position-data:has(.fa-map-marker) .job-group-item", "location")) === "", "159216's empty field reads nothing");
  } catch (err) {
    console.error(`FAIL: the fixture threw: ${(err as Error).message}`);
    failures++;
  } finally {
    await browser?.close();
  }
  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("locationMap: all assertions passed");
})();
