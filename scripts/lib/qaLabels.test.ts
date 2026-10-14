// Run: npx tsx scripts/lib/qaLabels.test.ts
//
// H6 (owner, 2026-10-14): QA's publish-date and department cues match a label
// at the start of a line or before a colon, never inside a word. The negative
// fixtures are the report's: "המכרז יפורסם" (Jerusalem Transportation) and
// "בתחום" in a job title (TECH, Colmex, TOP BIT).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPARTMENT_LABELS, PUBLISH_DATE_LABELS, hasLabel } from "./qaLabels";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const date = (t: string) => hasLabel(t, PUBLISH_DATE_LABELS);
const dept = (t: string) => hasLabel(t, DEPARTMENT_LABELS);

// The negatives from the report: a label inside another word.
assert(!date("מהנדס/ת תשתיות וביצוע\nהמכרז יפורסם לפחות עד ליום 30.10.2026"), '"המכרז יפורסם" is not a publish date');
assert(!dept("מנהל/ת פרויקטים בתחום התשתיות\nדרישות התפקיד"), '"בתחום" in a job title is not a department');
assert(!dept("בודק/ת חשבונות – תחום הבינוי והתשתיות"), "a label in the middle of a line with no colon is not one");
assert(!date("Republished jobs"), "an English label inside a word is not one either");
assert(!dept("Our teams are growing"), '"teams" is not "team"');

// The positives: a label at the start of a line, or before a colon.
assert(date("תאריך פרסום: 12/10/2026"), "תאריך פרסום: at the start of a line");
assert(date("משרה 4711 | פורסם: 3.10.2026"), "פורסם before a colon, mid-line");
assert(date("• פורסם לפני 3 ימים"), "פורסם at the start of a line, after a bullet");
assert(date("Posted on: Oct 3, 2026") && date("Published: 2026-10-03") && date("Date posted 3 Oct"), "the English labels");
assert(dept("מחלקה: כספים") && dept("תחום: מכירות") && dept("אגף משאבי אנוש"), "the Hebrew department labels");
assert(dept("Department: Sales") && dept("Team : Platform"), "the English department labels, a space before the colon included");
assert(!date("") && !dept("   \n  "), "an empty page has no label");

// The wiring: addsite-qa reads the two cues through hasLabel, from the page's lines.
const qa = readFileSync(join(__dirname, "..", "addsite-qa.ts"), "utf8");
assert(/fieldsOnPage\.publishDate = hasLabel\(labelText, PUBLISH_DATE_LABELS\)/.test(qa), "addsite-qa sets publishDate through hasLabel");
assert(/fieldsOnPage\.department = hasLabel\(labelText, DEPARTMENT_LABELS\)/.test(qa), "and department");
assert(!/publishDate: has\(/.test(qa) && !/department: has\(/.test(qa), "the anywhere-in-the-text matches are gone");
assert(/const labelText = document\.body\?\.innerText \|\| ""/.test(qa), "the labels are read from innerText with its lines, not the collapsed body text");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("qaLabels: a label at the start of a line or before a colon, never inside a word");
