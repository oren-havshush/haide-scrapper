// Run: npx tsx worker/lib/gazetteer-location.test.ts
//
// Covers the "ל<noun> <city>" recovery pattern and, more importantly, the
// precedence that keeps it from outranking higher-confidence matches.
// All fixtures are real ad text from production.

import { extractLocationFromGazetteer } from "./normalizer";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}
const eq = (got: string | null, want: string | null, msg: string) => {
  if (got !== want) {
    console.error(`FAIL: ${msg}\n  got=${got}\n  want=${want}`);
    process.exit(1);
  }
};

// --- "ל<noun> <city>": the city carries no ב prefix of its own -------------

eq(
  extractLocationFromGazetteer("מחסנאי/ת לנמל אשדוד דרוש/ה מחסנאי/ת!"),
  "אשדוד",
  "recovers city after a ל-prefixed workplace noun (לנמל אשדוד)",
);
eq(
  extractLocationFromGazetteer("דרוש/ה נהג/ת חלוקה 12 טון למושב כנות חברת ישרקו"),
  "כנות",
  "recovers city after למושב",
);

// --- precedence: the ל<noun> pattern must not outrank a real match ---------

// The regression this ordering exists to prevent: "מצליח" is an adjective here
// ("a successful factory"), and must not beat the explicit "ברמת הגולן".
eq(
  extractLocationFromGazetteer("דרוש/ה מפעיל/ת CNC למפעל מצליח ברמת הגולן!!"),
  "רמת הגולן",
  "a ב-prefixed region outranks an adjective sitting after a ל-noun",
);
// A bare "ב<city>" is higher confidence and must win.
eq(
  extractLocationFromGazetteer("דרוש/ה עובד/ת למפעל גדול בקרית גת"),
  "קרית גת",
  "a ב-prefixed city outranks the ל-noun pattern",
);

// --- guards that must keep holding ----------------------------------------

eq(
  extractLocationFromGazetteer("דרוש/ה עובד/ת למשרה מלאה בתנאים טובים"),
  null,
  "מלאה (full-time) is denied globally and must not resolve",
);
eq(
  extractLocationFromGazetteer("העבודה במשמרות בוקר וערב"),
  null,
  "משמרות (shifts) must not resolve via the bare prefix",
);
assert(extractLocationFromGazetteer("") === null, "empty text yields null");
assert(
  extractLocationFromGazetteer("דרוש/ה מנהל/ת צוות לחברה מובילה") === null,
  "text with no place yields null",
);

// --- direction words qualify the city, they are not the location ----------

// tigbur job 232880: stored אזור צפון, but the ad says north Tel Aviv.
eq(
  extractLocationFromGazetteer('לארגון בצפון ת"א דרוש\\ה מהנדס\\ת מכונות'),
  "תל אביב-יפו",
  'בצפון ת"א resolves to Tel Aviv, not the northern region',
);
eq(
  extractLocationFromGazetteer("דרוש/ה עובד/ת לחברה בדרום תל אביב"),
  "תל אביב",
  "בדרום <city> resolves to the city",
);
// With no city after it, the direction is still a legitimate region read.
eq(
  extractLocationFromGazetteer("המשרה בצפון הארץ, נדרשת ניידות"),
  "צפון",
  "a direction with no city after it still reads as a region",
);

// --- city abbreviations ---------------------------------------------------

eq(
  extractLocationFromGazetteer('דרוש/ה מנהל/ת חשבונות בת"א'),
  "תל אביב-יפו",
  'בת"א resolves via abbreviation',
);
eq(
  extractLocationFromGazetteer("דרוש/ה מלצר/ית בב״ש למשמרות ערב"),
  "באר שבע",
  "Hebrew gershayim (U+05F4) is accepted as well as ASCII quote",
);
eq(
  extractLocationFromGazetteer('דרוש/ה נהג/ת בפ"ת'),
  "פתח תקווה",
  'בפ"ת resolves to פתח תקווה',
);

// --- אזור is "the area of", not the town ----------------------------------

eq(
  extractLocationFromGazetteer('לבסיס של צה"ל באזור צומת שוקת דרוש/ה טכנאי/ת'),
  null,
  "באזור (in the area of) must not resolve to the town אזור",
);

// --- existing behaviour still intact --------------------------------------

eq(
  extractLocationFromGazetteer("לחברה מובילה ברחובות דרוש/ה מבקר/ת טיב"),
  "רחובות",
  "bare ב<city> still works",
);

console.log("PASS: all gazetteer-location assertions");
