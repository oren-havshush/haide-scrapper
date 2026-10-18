// Run: npx tsx worker/lib/applyEmail.test.ts
//
// Which email in a job's text may become its apply address (developer's
// report 2026-10-18, item 1): only one on a line with an apply cue (albar's
// inquiries paragraph has none). One on most of the run's jobs is kept and
// named in a warning (tl-care: its one HR mailbox on every ad).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeJobRecord } from "./normalizer";
import { cueLineEmail, fallbackApplyEmailOf, siteWideApplyEmails, siteWideApplyEmailWarnings } from "./applyEmail";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// The albar shape: the ad, then an inquiries paragraph with no apply cue.
const albar =
  "דרוש/ה נציג/ת שירות לקוחות למוקד החברה.\n" +
  "עבודה במשמרות, תנאים מצוינים.\n" +
  "לבירורים ופניות בנושא פרטיות ניתן לפנות לכתובת pniyot@albar.co.il";

{
  const n = normalizeJobRecord({ title: "נציג/ת שירות", description: albar });
  assert(n.applicationInfo == null || n.applicationInfo === "", `albar: no cue, no apply address (got ${JSON.stringify(n.applicationInfo)})`);
  assert(cueLineEmail(albar) === null, "albar: cueLineEmail is null");
}

// A cue on the email's own line.
{
  const text = "מחפשים מהנדס/ת תוכנה.\n" + 'קו"ח ל-jobs@x.co.il';
  const n = normalizeJobRecord({ title: "מהנדס/ת תוכנה", description: text });
  assert(n.applicationInfo === "jobs@x.co.il", `a cue line gives its address (got ${JSON.stringify(n.applicationInfo)})`);
  assert(n.rawFields["_enrichedFromDescription_applicationInfo"] === "jobs@x.co.il", "and marks it as the fallback's");
}

// The other cues, and the gershayim spelling of קו"ח.
{
  const gershayim = "קו" + String.fromCharCode(0x05f4) + "ח";
  const cases: Array<[string, string]> = [
    [`${gershayim}: a@x.co.il`, "a@x.co.il"],
    ["נא לשלוח קורות חיים למייל b@x.co.il", "b@x.co.il"],
    ["להגשת מועמדות: c@x.co.il", "c@x.co.il"],
    ["שלחו אלינו d@x.co.il", "d@x.co.il"],
    ["Send your CV to e@x.com", "e@x.com"],
    ["To apply, write to f@x.com", "f@x.com"],
  ];
  for (const [line, want] of cases) assert(cueLineEmail("intro\n" + line) === want, `cue line "${line}" gives ${want}`);
  assert(cueLineEmail("קו\"ח:\ng@x.co.il") === null, "the cue must be on the email's own line");
  assert(cueLineEmail("Contact us at h@x.com about privacy") === null, "an English line with no cue is not taken");
}

// The phone fallback is unchanged.
{
  const n = normalizeJobRecord({ title: "נהג/ת", description: "לפרטים: 050-1234567" });
  assert(n.applicationInfo === "050-1234567", `phone fallback unchanged (got ${JSON.stringify(n.applicationInfo)})`);
}

// The run's view, as buildJobRows applies it: normalise each job, take each
// row's fallback email, warn on one that is on most rows, keep every value.
function runView(descriptions: string[]) {
  const normalized = descriptions.map((d, i) => normalizeJobRecord({ title: `משרה ${i}`, description: d }));
  const emails = normalized.map((n) => fallbackApplyEmailOf(n.rawFields, n.applicationInfo));
  return { stored: normalized.map((n) => n.applicationInfo || null), warnings: siteWideApplyEmailWarnings(siteWideApplyEmails(emails), normalized.length) };
}

// tl-care: one cue line, the same address on all 16 jobs. Kept on every row, and named.
{
  const tlCare = (i: number) =>
    `דרוש/ה מטפל/ת לקשיש/ה, משרה ${i}.\n` +
    "קורות חיים בצירוף פרטי המשרה נא לשלוח לפקס 03-7612249 או למייל ilanitD@tl-care.co.il";
  const { stored, warnings } = runView(Array.from({ length: 16 }, (_, i) => tlCare(i)));
  assert(stored.every((v) => v === "ilanitD@tl-care.co.il"), `tl-care: the address is kept on all 16 rows (got ${JSON.stringify([...new Set(stored)])})`);
  assert(
    JSON.stringify(warnings) === JSON.stringify(["apply_email_site_wide: ilanitd@tl-care.co.il on 16 of 16"]),
    `tl-care: one warning, apply_email_site_wide: <address> on N of M (got ${JSON.stringify(warnings)})`,
  );
}

// albar: the inquiries paragraph on every job, no cue. Null on every row, no warning.
{
  const { stored, warnings } = runView(Array.from({ length: 5 }, () => albar));
  assert(stored.every((v) => v === null), `albar: null on every row (got ${JSON.stringify([...new Set(stored)])})`);
  assert(warnings.length === 0, `albar: no warning (got ${JSON.stringify(warnings)})`);
}

// The count's edges.
{
  const rows = ["jobs@x.co.il", "JOBS@x.co.il", "jobs@x.co.il", null];
  const siteWide = siteWideApplyEmails(rows);
  assert(siteWide.get("jobs@x.co.il") === 3, `3 of 4 is site-wide (got ${JSON.stringify([...siteWide])})`);
  assert(
    JSON.stringify(siteWideApplyEmailWarnings(siteWide, 4)) === JSON.stringify(["apply_email_site_wide: jobs@x.co.il on 3 of 4"]),
    "one warning, apply_email_site_wide: <address> on N of M",
  );
  assert(siteWideApplyEmails(["a@x.co.il", "a@x.co.il", "b@x.co.il", "b@x.co.il"]).size === 0, "exactly half is not more than half");
  assert(siteWideApplyEmails(["a@x.co.il", "a@x.co.il"]).size === 0, "two rows raise no warning (the minimum is 3)");
  assert(fallbackApplyEmailOf({ _enrichedFromDescription_applicationInfo: "a@x.co.il" }, "a@x.co.il") === "a@x.co.il", "a fallback email is recognised");
  assert(fallbackApplyEmailOf({ _enrichedFromDescription_applicationInfo: "a@x.co.il" }, "https://x.co.il/apply") === null, "a selector's value is not the fallback's");
  assert(fallbackApplyEmailOf({ _enrichedFromDescription_applicationInfo: "03-1234567" }, "03-1234567") === null, "a phone is not counted");
}

// scrape.ts: buildJobRows counts the run's fallback emails and warns; the row
// keeps the normalizer's value; the written run carries the warning.
{
  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
  const start = src.indexOf("function buildJobRows(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert(/args\.applyEmailWarnings\.push\(\s*\.\.\.siteWideApplyEmailWarnings\(siteWideApplyEmails\(fallbackEmails\), args\.records\.length\),?\s*\)/.test(body), "buildJobRows warns on the run's fallback emails");
  assert(/applicationInfo: normalized\.applicationInfo \|\| null,/.test(body), "and the row keeps the normalizer's value");
  assert(!/siteWide\.has\(/.test(body), "nothing nulls a site-wide address");
  assert(/applyEmailWarnings,\n\s*\}\);/.test(src.slice(src.indexOf("const rows = buildJobRows({"))), "the run passes its warning list");
  assert(/scrapeWarnings\.push\(\.\.\.applyEmailWarnings\);/.test(src), "the written run reports the warning");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("applyEmail: a cue-line email only; one on most of the run's jobs is kept and named");
