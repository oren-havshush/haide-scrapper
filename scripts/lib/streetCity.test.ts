// Run: npx tsx scripts/lib/streetCity.test.ts
//
// The city gate never reads a street's own name as the city (developer's
// report 2026-10-18, item 3): storenext.co.il's "רחוב המגשימים" gave
// מגשימים, a real moshav on city.csv. A segment that opens with a street word
// yields a city only from a place that follows its street and house number.
// This is the city gate; a wrong city is the worst value we publish.

import { isKnownCity, loadCityList, matchCityInAddress } from "./city-csv";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const cities = loadCityList();
assert(isKnownCity("מגשימים", cities), "the premise: מגשימים is on city.csv");

const cases: Array<[string, string | null]> = [
  // storenext: the street alone yields no city.
  ["רחוב המגשימים 20", null],
  ["רח' המגשימים 20", null],
  ["רחוב המגשימים", null],
  // A place after the street and number is the city.
  ["רחוב המגשימים 20, פתח תקווה", "פתח תקווה"],
  ["רחוב המגשימים 20 פתח תקווה", "פתח תקווה"],
  // Other street words, the same rule.
  ["שדרות רחובות 4", null],
  ["דרך חיפה 12", null],
  ["דרך חיפה 12, עכו", "עכו"],
  ["כיכר אתרים 1 תל אביב", "תל אביב-יפו"],
  // The cases that already held, still holding.
  ["רחוב יגאל אלון 53 תל אביב מיקוד 6706206", "תל אביב-יפו"],
  ["רח' אבא הלל 14, בית עוז ר״ג 52506", "רמת גן"],
  ["רחוב היוזמה 41 אזה״ת הצפוני אשדוד", "אשדוד"],
  ["השדרה האקדמית 1 קרית אונו", "קריית אונו"],
  ["רחוב 12", null],
  // A segment that does not open with a street word is unchanged.
  ["פתח תקווה", "פתח תקווה"],
  ["ספיר 1 הרצליה", "הרצליה"],
  // Report fixes 3, item 6 (LRN-LOC-28): an industrial zone with its prefix is
  // the zone row, both rows; gsbgroup's head office, as printed.
  ["אדום 33, אזור התעשייה כנות", "אזור תעשיה כנות"],
  ["אדום 33, א.ת כנות", "אזור תעשיה כנות"],
  ["רחוב אדום 33 א.ת כנות", "אזור תעשיה כנות"],
  ["אזור תעשיה ברקן", "אזור תעשיה ברקן"],
  ["רחוב התעשייה 5, א.ת ברקן", "אזור תעשיה ברקן"],
  ["אזור התעשייה ברקן", "אזור תעשיה ברקן"],
  // The bare name is still the town.
  ["הדקל 3, כנות", "כנות"],
];
for (const [address, want] of cases) {
  const got = matchCityInAddress(address, cities);
  assert(got === want, `${JSON.stringify(address)} -> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  if (got !== null) assert(isKnownCity(got, cities), `the gate returned an off-list value: ${got}`);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("streetCity: a street's own name is never the city; a place after the street and number is");
