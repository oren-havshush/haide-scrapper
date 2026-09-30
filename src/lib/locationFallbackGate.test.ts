// Run: npx tsx src/lib/locationFallbackGate.test.ts
//
// _meta.locationFallback is stamped onto every job that states no place of its
// own, so it is published data on every such row. It is now checked on save
// against "CSV files/city.csv", verbatim: a fallback the city list rejects used
// to reach the location column raw (worker/lib/jobLocation.ts), which is how
// clalitsmile came to publish "רחב".

import { updateSiteConfigSchema } from "./validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const BASE = { fieldMappings: {}, pageFlow: [] as unknown[], formCapture: null };
const parse = (locationFallback?: unknown) =>
  updateSiteConfigSchema.safeParse(locationFallback === undefined ? BASE : { ...BASE, locationFallback });
const ok = (v?: unknown) => parse(v).success;

assert(ok(), "absent is fine — most sites have no fallback");
assert(ok("חיפה"), "a city verbatim on city.csv is accepted");
assert(ok("תל אביב-יפו"), "including a hyphenated one");
assert(ok("אזור מרכז"), "and a region that is on the list");
assert(ok("פריסה ארצית"), "and the nationwide marker, which is on the list");

assert(!ok("רחב"), "a word city.csv does not contain is refused (clalitsmile's value)");
assert(!ok("Unknown"), '"Unknown" is the absence of a place, not a fallback');
assert(!ok("צפון"), "a near-miss is refused too — the list says אזור צפון, and the rule is verbatim");
assert(!ok("חיפה "), "surrounding whitespace is not verbatim");
assert(!ok(""), "an empty string is not a place");

const r = parse("רחב");
const msg = r.success ? "" : r.error.issues.map((i) => i.message).join(" ");
assert(msg.includes("city.csv") && msg.includes("רחב"), `the error names the rule and the value (${msg})`);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("locationFallbackGate: a site's fallback location is on city.csv, verbatim, or it is not saved");
