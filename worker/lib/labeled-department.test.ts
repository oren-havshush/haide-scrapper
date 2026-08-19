// Run: npx tsx worker/lib/labeled-department.test.ts
//
// Regression: the description-text fallback used to recover `department` from any
// occurrence of מחלקה/אגף/צוות/Team followed by a colon or dash. In Hebrew ads those
// words live in ordinary prose ("ניסיון בניהול צוות – יתרון"), so the capture was the
// requirement's qualifier, not a department. Measured on the live fleet: 38 departments
// came from prose, 37 of them junk. The fallback now demands a line-leading label, a
// short value, and no qualifier word — and no longer looks at צוות/Team at all.

import { normalizeJobRecord } from "./normalizer";

let failures = 0;
function check(name: string, fields: Record<string, string>, expected: string) {
  const got = normalizeJobRecord(fields).department;
  if (got !== expected) {
    console.error(`FAIL: ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(got)}`);
    failures++;
  }
}

// --- prose that must NOT become a department -------------------------------
check("qualifier after a team-management bullet (natali 616502)", {
  title: "מנהל/ת מטה קהילות תומכות",
  description: "דרוש/ה מנהל/ת מטה לנטלי שירותי רפואה- בורסה רמת גן",
  requirements: "• ניסיון בעבודה אדמיניסטרטיבית\n• ניסיון בניהול צוות – יתרון\n• שליטה ב-Excel",
}, "");

check("qualifier after a department-management line (JUMBO)", {
  title: "מנהל/ת מחלקה",
  description: "ניהול סניף",
  requirements: "ניסיון בניהול מחלקה - חובה\nיחסי אנוש מעולים",
}, "");

check("a date is not a department", {
  title: "דרושים.ות אנשי צוות",
  description: "דרושים.ות אנשי צוות – 02.07.2026",
  requirements: "",
}, "");

check("a whole sentence is not a department", {
  title: "מפעיל/ה מערך שינוע",
  description: "",
  requirements: "מחלקה: יכולת לעבוד בשיתוף פעולה עם חברי הצוות ועם מחלקות מקבילות ולרתום בעלי עניין",
}, "");

// --- real labels that must still be recovered ------------------------------
check("line-leading label", {
  title: "בקר/ית איכות",
  description: "תיאור התפקיד",
  requirements: "מחלקה: בקרת איכות\nדרישות: ניסיון של שנתיים",
}, "בקרת איכות");

check("line-leading label behind a bullet", {
  title: "רכז/ת גיוס",
  description: "תיאור",
  requirements: "• אגף: משאבי אנוש\n• ניסיון קודם",
}, "משאבי אנוש");

// --- an explicit selector mapping always wins ------------------------------
check("explicit department mapping is untouched", {
  title: "מפתח/ת",
  department: "צוות תשתיות",
  description: "ניהול צוות – יתרון",
  requirements: "",
}, "צוות תשתיות");

if (failures) {
  console.error(`labeled-department.test.ts: ${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log("labeled-department.test.ts: all assertions passed");
}
