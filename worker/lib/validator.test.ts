// Run: npx tsx worker/lib/validator.test.ts
//
// Regression cover for the non_job_content rules. The FOX HOME fixtures are
// real production titles from dreamjobs.co.il (קבוצת ויזל - פוקס) that the
// previous unanchored /home/i pattern rejected — 44 valid postings dropped in
// a single scrape on 2026-08-12.

import { validateJobRecord } from "./validator";
import type { NormalizedJobRecord } from "./normalizer";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

/** Minimal record shaped like normalizeJobRecord() output. */
function rec(over: Partial<NormalizedJobRecord> = {}): NormalizedJobRecord {
  return {
    title: "יועץ/ת מכירה",
    company: "",
    location: "תל אביב",
    description: "תיאור משרה מלא עם מספיק תוכן כדי להיראות אמיתי.",
    requirements: "",
    department: "",
    externalJobId: "12345",
    publishDate: "",
    deadline: "",
    applicationInfo: "",
    url: "https://example.com/job/12345",
    rawFields: { description: "תיאור משרה" },
    ...over,
  } as NormalizedJobRecord;
}

const isValid = (r: Partial<NormalizedJobRecord>) => validateJobRecord(rec(r)).isValid;
const reason = (r: Partial<NormalizedJobRecord>) => validateJobRecord(rec(r)).status;

// ---------------------------------------------------------------------------
// 1. Standalone navigation labels MUST still be rejected
// ---------------------------------------------------------------------------
const NAV_LABELS = [
  "Home", "home", "HOME", "Homepage", "homepage",
  "About", "about", "About Us", "about us", "ABOUT US",
  "Contact", "contact", "Contact Us",
  "Privacy", "Privacy Policy",
  "Terms", "Terms of Use", "Terms of Service",
];
for (const label of NAV_LABELS) {
  assert(!isValid({ title: label }), `nav label as title must be rejected: ${label}`);
  assert(
    reason({ title: label }).includes("non_job_content"),
    `nav label must be flagged non_job_content: ${label}`,
  );
}

// padded / punctuated variants still rejected
assert(!isValid({ title: "  Home  " }), "whitespace-padded nav label rejected");
assert(!isValid({ title: "\tAbout Us " }), "tab-padded nav label rejected");

// the same rule applies to the location field
assert(!isValid({ location: "Home" }), "nav label as location rejected");
assert(!isValid({ location: "Contact Us" }), "nav label as location rejected (contact us)");

// ---------------------------------------------------------------------------
// 2. Hebrew nav labels + UI hints unchanged (patterns 2 and 3 untouched)
// ---------------------------------------------------------------------------
for (const label of [
  "על החברה", "אודות", "עמוד הבית", "צור קשר", "מדיניות פרטיות", "תנאי שימוש", "תקנון",
]) {
  assert(!isValid({ title: label }), `hebrew nav label rejected: ${label}`);
}
assert(!isValid({ title: "לחצו עם העכבר כדי לערוך" }), "ui hint rejected");
assert(!isValid({ title: "Press ESC to close" }), "press esc rejected");

// "תנאים" on its own is legitimate IL job-ad wording — must stay valid
assert(isValid({ title: "יועץ/ת מכירה תנאים מצויינים" }), "'תנאים' must not be non_job_content");

// ---------------------------------------------------------------------------
// 3. Real job titles containing a nav word MUST be valid (the regression)
// ---------------------------------------------------------------------------
const REAL_FOX_HOME_TITLES = [
  "אחראי/ת משמרת FOX HOME בית שמש",            // prod id 9954
  "אחראי/ת משמרת FOX HOME גבעת שמואל",          // prod id 9799
  "אחראי/ת משמרת FOX HOME גינדי תל-אביב",        // prod id 10392
  "סגן/ית מנהל לסניף FOX HOME סניף ביג אילת",     // prod id 10296
  "אחראי/ת משמרת FOX HOME קניון הזהב -ראשון לציון", // prod id 10105
];
for (const title of REAL_FOX_HOME_TITLES) {
  assert(isValid({ title }), `real FOX HOME posting must be valid: ${title}`);
}

for (const title of [
  "נציג/ת שירות Contact Center",
  "מנהל/ת משמרת Home Center ראשון לציון",
  "About You - מנהל/ת חנות",
  "Home Style יועץ/ת מכירה",
  "מנהל/ת מוקד Contact Center לילה",
]) {
  assert(isValid({ title }), `job title containing a nav word must be valid: ${title}`);
}

// a nav word inside the location is fine too (branch names)
assert(isValid({ location: "Home Center גלילות" }), "location containing a nav word is valid");

// ---------------------------------------------------------------------------
// 4. Required-field behaviour unchanged
// ---------------------------------------------------------------------------
assert(!isValid({ title: "" }), "empty title is invalid");
assert(reason({ title: "" }).includes("missing_title"), "empty title reports missing_title");
assert(isValid({}), "ordinary job record is valid");

// ---------------------------------------------------------------------------
// 5. Property: the new pattern is strictly NARROWER than the old one.
//    Anything the new rule rejects, the old substring rule rejected too —
//    so this change can never introduce a NEW rejection.
// ---------------------------------------------------------------------------
const OLD = /about us|about|home|contact|privacy|terms/i;
const NEW =
  /^\s*(?:about(?: us)?|home(?:page)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?)\s*$/i;
const CORPUS = [
  ...NAV_LABELS, ...REAL_FOX_HOME_TITLES,
  "  Home  ", "Homepage", "נציג/ת שירות Contact Center", "מנהל/ת משמרת Home Center",
  "יועץ/ת מכירה", "About You - מנהל/ת חנות", "terms of service", "PRIVACY POLICY",
  "אחראי/ת משמרת FOX HOME", "Homestead Manager", "Contactless Payments Lead",
];
for (const s of CORPUS) {
  if (NEW.test(s)) {
    assert(OLD.test(s), `new pattern must be a subset of old — leaked: ${JSON.stringify(s)}`);
  }
}

console.log(`PASS: validator non_job_content regression (${NAV_LABELS.length} nav labels, ${REAL_FOX_HOME_TITLES.length} real FOX HOME titles, ${CORPUS.length} corpus entries)`);
