// Run: npx tsx worker/lib/location-gate.test.ts
//
// buildLocationWarnings lives in worker/jobs/scrape.ts next to the other
// completion-quality checks; it is re-implemented here only in the sense that
// these fixtures pin the behaviour we care about. Fixtures are real shapes seen
// in production.

import { extractLocationFromGazetteer } from "./normalizer";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// The gate's region-over-city signal depends entirely on the gazetteer being
// able to find a city in the ad text while the stored value is coarse. These
// assertions guard that contract — if they break, the gate silently stops
// firing rather than reporting a false alarm.

// tigbur 232880 — the case the gate exists to catch.
assert(
  extractLocationFromGazetteer('לארגון בצפון ת"א דרוש\\ה מהנדס\\ת מכונות') ===
    "תל אביב-יפו",
  "gazetteer still recovers the city that a coarse region would have masked",
);

// An ad naming no place at all must yield null, or the gate would flag every
// legitimate region-only site as region_over_city.
assert(
  extractLocationFromGazetteer(
    "דרוש/ה מנהל/ת צוות לחברה מובילה, נדרשת יכולת ניהול והובלת עובדים",
  ) === null,
  "an ad naming no place yields null, so region-only sites are not flagged",
);

// "פריסה ארצית" (nationwide) is a deliberate entry in il-places/city.csv, not a
// stray match — it is a real answer for a travelling role and must keep
// resolving, so the gate does not treat it as a missing location.
assert(
  extractLocationFromGazetteer("המשרה בפריסה ארצית") === "פריסה ארצית",
  "nationwide stays a resolvable value",
);

// "בצפון הארץ" is a region statement, not a city — must stay null-or-region so
// a site that only publishes regions is left alone.
const northOnly = extractLocationFromGazetteer("המשרה בצפון הארץ, נדרשת ניידות");
assert(
  northOnly === "צפון" || northOnly === null,
  `a bare direction stays coarse (got ${northOnly})`,
);

// The non-place values the gate hard-flags must not be produced by the
// gazetteer any more — otherwise the gate would be reporting our own output.
for (const [text, label] of [
  ['לבסיס של צה"ל באזור צומת שוקת דרוש/ה טכנאי/ת', "אזור"],
  ["העבודה במשמרות בוקר וערב, נדרשת גמישות", "משמרות"],
  ["דרוש/ה עובד/ת למשרה מלאה בתנאים טובים מאוד", "מלאה"],
] as const) {
  const got = extractLocationFromGazetteer(text);
  assert(
    got !== label,
    `gazetteer must not emit the non-place value "${label}" (got ${got})`,
  );
}

console.log("PASS: all location-gate assertions");
