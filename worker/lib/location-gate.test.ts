// Run: npx tsx worker/lib/location-gate.test.ts
//
// buildLocationWarnings (worker/jobs/scrape.ts) reports `region_over_city`: the
// site stored a coarse region while the ad names a city. It asks the gazetteer
// for that city, so the warning exists only to the extent the gazetteer can
// still find one — and since the scan became anchored, it can find one in
// strictly fewer places.
//
// These assertions pin what the gate can and cannot see, so the narrowing is a
// recorded fact rather than a warning that quietly stopped firing.

import { extractLocationFromGazetteer } from "./normalizer";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

// --- what the gate CAN still see ------------------------------------------

// tikshoov 5084 — the ad names גבעת שמואל at its own label while the board
// files the job under אזור שפלה. This is the shape the gate exists to catch,
// and it is an anchored one.
eq(
  extractLocationFromGazetteer("שירות מהבית | רימון ספקית אינטרנט\nמיקום המשרה: גבעת שמואל"),
  ["גבעת שמואל"],
  "a labelled city is still recovered while the stored value is a region",
);
eq(
  extractLocationFromGazetteer("העבודה במשרדי החברה בחיפה"),
  ["חיפה"],
  "and so is one named at the employer's own premises",
);

// --- what the gate can no longer see ---------------------------------------

// tigbur 232880 — the ad says north Tel Aviv with no label and no premises
// word. The gate used to catch this one; it no longer does. Stated here rather
// than left to be discovered: the region-over-city warning is now blind to
// unanchored prose, which is the same blindness that stops it inventing.
eq(
  extractLocationFromGazetteer('לארגון בצפון ת"א דרוש\\ה מהנדס\\ת מכונות'),
  [],
  "an unanchored city is not recovered, so the gate no longer flags tigbur 232880",
);

// --- and what it must never see -------------------------------------------

// An ad naming no place must yield nothing, or the gate would flag every
// legitimate region-only site as region_over_city.
eq(
  extractLocationFromGazetteer(
    "דרוש/ה מנהל/ת צוות לחברה מובילה, נדרשת יכולת ניהול והובלת עובדים",
  ),
  [],
  "an ad naming no place yields nothing, so region-only sites are not flagged",
);

// "פריסה ארצית" is a real city.csv entry and a real answer for a travelling
// role; it must keep resolving where the ad labels it, so the gate does not
// treat it as a missing location.
eq(
  extractLocationFromGazetteer("מיקום המשרה: פריסה ארצית"),
  ["פריסה ארצית"],
  "nationwide stays a resolvable value",
);

// The non-place values the gate hard-flags must never come from us — otherwise
// the gate would be reporting our own output back to the operator.
for (const [text, label] of [
  ['לבסיס של צה"ל באזור צומת שוקת דרוש/ה טכנאי/ת', "אזור"],
  ["העבודה במשמרות בוקר וערב, נדרשת גמישות", "משמרות"],
  ["דרוש/ה עובד/ת למשרה מלאה בתנאים טובים מאוד", "מלאה"],
  ["המשרד ממוקם בשדרות רוטשילד 15", "שדרות"],
] as const) {
  const got = extractLocationFromGazetteer(text);
  if (got.includes(label)) {
    console.error(`FAIL: the gazetteer must not emit the non-place value "${label}"`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("PASS: all location-gate assertions");
