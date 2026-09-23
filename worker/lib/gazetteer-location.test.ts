// Run: npx tsx worker/lib/gazetteer-location.test.ts
//
// THE LEDGER OF WHAT THE ANCHORED SCAN GAVE UP.
//
// This file used to cover the bare-word gazetteer: "ל<noun> <city>", bare
// "ב<city>", a cue within 30 characters, direction words. Every fixture below
// is real production ad text that the old scan was written for, and every one
// is kept — with the value the anchored scan returns now.
//
// Keeping them is the point. The shapes that recovered אשדוד from "לנמל אשדוד"
// are the same shapes that read `משמרות` out of "עבודה במשמרות" and `שדרות` out
// of "שדרות בן גוריון 6" (see anchoredGazetteer.test.ts for those five). There
// is no rule that keeps one and drops the other, so the recoveries went with
// the inventions. Deleting the fixtures would hide that trade; asserting the
// new answer makes it a decision on the record, and makes an accidental
// re-introduction of prose scanning fail here.

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

// --- KEPT: the anchor happens to be one of the employer's own premises ------

console.log("# kept, because the ad names the place at an anchor");

eq(
  extractLocationFromGazetteer("דרוש/ה עובד/ת למפעל גדול בקרית גת"),
  ["קרית גת"],
  "למפעל … ב<city> — מפעל is a site noun, so this still resolves",
);
eq(
  extractLocationFromGazetteer("לחברה מובילה בסניף רחובות דרוש/ה מבקר/ת טיב"),
  ["רחובות"],
  "בסניף <city> still resolves",
);

// --- GIVEN UP: no anchor, so nothing is read -------------------------------

console.log("# given up, deliberately");

eq(
  extractLocationFromGazetteer("מחסנאי/ת לנמל אשדוד דרוש/ה מחסנאי/ת!"),
  [],
  "לנמל אשדוד — נמל is not one of the five premises words",
);
eq(
  extractLocationFromGazetteer("דרוש/ה נהג/ת חלוקה 12 טון למושב כנות חברת ישרקו"),
  [],
  "למושב כנות — and כנות is the word CLAUDE.md names as hiding inside הסוכנות",
);
eq(
  extractLocationFromGazetteer("דרוש/ה מפעיל/ת CNC למפעל מצליח ברמת הגולן!!"),
  [],
  "למפעל מצליח ברמת הגולן — the anchor fires, but מצליח is not a place and " +
    "the ב-word is past it: no value the list contains",
);
eq(
  extractLocationFromGazetteer("לחברה מובילה ברחובות דרוש/ה מבקר/ת טיב"),
  [],
  "a bare ב<city> with no anchor is no longer read",
);
eq(
  extractLocationFromGazetteer('דרוש/ה מנהל/ת חשבונות בת"א'),
  [],
  'and neither is a bare abbreviation — בת"א has no anchor either',
);
eq(
  extractLocationFromGazetteer('לארגון בצפון ת"א דרוש\\ה מהנדס\\ת מכונות'),
  [],
  'בצפון ת"א — the direction patterns are gone with the rest',
);
eq(
  extractLocationFromGazetteer("דרוש/ה עובד/ת לחברה בדרום תל אביב"),
  [],
  "בדרום תל אביב likewise",
);
eq(
  extractLocationFromGazetteer("המשרה בצפון הארץ, נדרשת ניידות"),
  [],
  "a bare direction reads as no place at all, rather than as a region",
);
eq(
  extractLocationFromGazetteer("📍 פארק המדע רחובות"),
  [],
  "a pictograph cue within 30 characters is no longer a licence to scan",
);

// --- the abbreviations still resolve, at an anchor --------------------------

console.log("# abbreviations, now only where the ad names a place");

eq(
  extractLocationFromGazetteer('מיקום המשרה: ת"א'),
  ["תל אביב-יפו"],
  'ת"א resolves via the abbreviation table',
);
eq(
  extractLocationFromGazetteer("מיקום המשרה: ב״ש"),
  ["באר שבע"],
  "Hebrew gershayim (U+05F4) is accepted as well as the ASCII quote",
);
eq(
  extractLocationFromGazetteer('כתובת: פ"ת'),
  ["פתח תקווה"],
  'פ"ת resolves to פתח תקווה',
);

// --- guards that must keep holding, and now hold by construction -----------

console.log("# the guards the old lists existed to provide");

eq(
  extractLocationFromGazetteer("דרוש/ה עובד/ת למשרה מלאה בתנאים טובים"),
  [],
  "מלאה (full-time) — no GAZETTEER_DENYLIST needed; there is no anchor",
);
eq(
  extractLocationFromGazetteer("העבודה במשמרות בוקר וערב"),
  [],
  "משמרות (shifts) — no BARE_PREFIX_DENYLIST needed either",
);
eq(
  extractLocationFromGazetteer('לבסיס של צה"ל באזור צומת שוקת דרוש/ה טכנאי/ת'),
  [],
  "באזור (in the area of) is not the town אזור",
);
eq(extractLocationFromGazetteer(""), [], "empty text yields nothing");
eq(
  extractLocationFromGazetteer("דרוש/ה מנהל/ת צוות לחברה מובילה"),
  [],
  "text with no place yields nothing",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nPASS: all gazetteer-location assertions");
