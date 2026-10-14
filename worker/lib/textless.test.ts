// Run: npx tsx worker/lib/textless.test.ts
//
// A job with no text (owner, 2026-10-14): isTextless, with point 4 (a
// description that only repeats the title is no text), and partitionTextless,
// the split a site flagged text-less by nature uses. Cases from the page check
// of 2026-10-14 (implementer-reports/2026-10-14-textless-gate.md, R1).

import { collapseText, isTextless, partitionTextless } from "./textless";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const NBSP = String.fromCharCode(0xa0);
const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const job = (title: string, description: string | null, requirements: string | null = null) => ({ title, description, requirements });

// Empty, in every form a page leaves it.
assert(isTextless(job("פקיד\\ה", null, null)), "both NULL is no text (tigbur)");
assert(isTextless(job("System Engineer", "", "  \n\t ")), "empty and whitespace-only is no text (experis)");
assert(isTextless(job("FP&A", `${NBSP} ${ZWSP}`, `${BOM}`)), "no-break and zero-width characters alone are no text");

// Either field alone keeps the job.
assert(!isTextless(job("נציג/ת", "ביצוע שיחות מכירה", null)), "a description alone is text");
assert(!isTextless(job("נציג/ת", null, "ניסיון במכירות")), "requirements alone are text");
assert(!isTextless(job("רישיו", null, "רישיו")), "requirements are text even when short (clalbit's cut-off)");

// Point 4: a description that only repeats the title is no text.
assert(isTextless(job("רכז כפר עופרים", "רכז כפר עופרים")), "civi: the description is the title");
assert(isTextless(job("אורזנים /ות בשדרות!", `  אורזנים${NBSP}/ות   בשדרות! `)), "l-m: the same after the whitespace collapse");
assert(isTextless(job("Product Manager", "product manager")), "and regardless of Latin case");
assert(!isTextless(job("רכז כפר עופרים", "רכז כפר עופרים", "ניסיון בהדרכה")), "but requirements still make it text");
assert(!isTextless(job("רכז כפר עופרים", "רכז כפר עופרים. משרה מלאה")), "and more than the title is text");
assert(!isTextless(job("", "סוג משרה: משרה מלאה")), "a description with no title to repeat is text");

assert(collapseText(`  a${NBSP}${ZWSP} b\n`) === "a b", "collapseText folds invisible runs into one space");
assert(collapseText(null) === "" && collapseText(undefined) === "", "and reads a missing value as empty");

// The flagged site's partition.
type Rec = { title: string; description: string | null; requirements: string | null; _detailNavStatus?: string };
const recs: Rec[] = [
  { title: "a", description: "text", requirements: null, _detailNavStatus: "ok" },
  { title: "b", description: null, requirements: null, _detailNavStatus: "ok" },
  { title: "c", description: null, requirements: null, _detailNavStatus: "http_error" },
  { title: "d", description: null, requirements: null, _detailNavStatus: "timeout" },
  { title: "e", description: null, requirements: null, _detailNavStatus: "unavailable" },
  { title: "f", description: null, requirements: null, _detailNavStatus: "skipped_no_url" },
  { title: "g", description: "g", requirements: null },
  { title: "h", description: null, requirements: "req", _detailNavStatus: "timeout" },
];
const p = partitionTextless(recs, (r) => ({ ...r, detailNavStatus: r._detailNavStatus }));
const names = (xs: Rec[]) => xs.map((x) => x.title).join("");
assert(names(p.kept) === "ah", `kept: the jobs with text, a dead visit's too (got ${names(p.kept)})`);
assert(names(p.dropped) === "bg", `dropped: text-less after a good visit, or with none (got ${names(p.dropped)})`);
assert(names(p.deadDropped) === "cdef", `deadDropped: text-less because the visit failed (got ${names(p.deadDropped)})`);
assert(p.kept.length + p.dropped.length + p.deadDropped.length === recs.length, "every record lands in exactly one part");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("textless: all assertions passed");
