// Run: npx tsx worker/lib/applicationInfoTemplate.test.ts
//
// applicationInfo goes through the same template fill as rawData._formData
// (developer's report 2026-10-18, item 2): a script writes the same form blob
// into both, and the column kept {{job.title}} literally (shlomit, krausz,
// hafoz, iec, barangroup).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fillRowApplicationInfo } from "./formTemplate";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const blob = (value: string) =>
  JSON.stringify({
    actionUrl: "https://x.test/apply",
    method: "POST",
    captureSource: "static",
    capturedAt: "2026-10-18T10:00:00.000Z",
    extractorVersion: 4,
    fields: [
      { name: "subject", label: "", fieldType: "hidden", required: false, tagName: "input", value },
      { name: "email", label: "Email", fieldType: "email", required: true, tagName: "input" },
    ],
  });
const job = { externalJobId: "x-4521", title: "מהנדס/ת תוכנה", url: "https://x.test/jobs/4521" };
const fieldValue = (s: string | null) => (s ? JSON.parse(s).fields[0].value : null);

// The script wrote "{{job.title}} - {{job.externalJobId}}"; the column stores the filled text.
{
  const tally = new Map<string, number>();
  const raw = { _formData: blob("{{job.title}} - {{job.externalJobId}}") };
  const out = fillRowApplicationInfo(blob("{{job.title}} - {{job.externalJobId}}"), raw, job, tally);
  assert(fieldValue(out) === "מהנדס/ת תוכנה - x-4521", `filled from the row's own job (got ${JSON.stringify(fieldValue(out))})`);
  assert(!/\{\{job\./.test(out ?? ""), "no token text is left in the column");
  assert(JSON.parse(out!).fields[1].name === "email", "the blob keeps its other fields");
}

// An unresolved token empties the field, as in _formData, and is counted once per row.
{
  const tally = new Map<string, number>();
  const noId = { externalJobId: null, title: "T", url: null };
  const withForm = fillRowApplicationInfo(blob("{{job.idNumber}}"), { _formData: blob("{{job.idNumber}}") }, noId, tally);
  assert(fieldValue(withForm) === "", "an unresolved token leaves the field empty");
  assert(tally.size === 0, "a row with _formData is counted there, not twice");
  fillRowApplicationInfo(blob("{{job.idNumber}}"), {}, noId, tally);
  assert(tally.get("subject (idNumber)") === 1, `a row with no _formData is counted here (got ${JSON.stringify([...tally])})`);
}

// Plain text with a token is filled; one that cannot be filled is null, never literal.
{
  const tally = new Map<string, number>();
  assert(fillRowApplicationInfo("Apply for {{job.title}}", {}, job, tally) === "Apply for מהנדס/ת תוכנה", "plain text is filled");
  assert(fillRowApplicationInfo("Ref {{job.urlParam:id}}", {}, job, tally) === null, "plain text with an unresolved token is null");
  assert(fillRowApplicationInfo("jobs@x.co.il", {}, job, tally) === "jobs@x.co.il", "a value with no token is returned as it is");
  assert(fillRowApplicationInfo(null, {}, job, tally) === null, "null stays null");
}

// scrape.ts: buildJobRows fills applicationInfo from the same job as _formData, with the run's tally.
{
  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
  const start = src.indexOf("function buildJobRows(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert(
    /applicationInfo: fillRowApplicationInfo\(\s*normalized\.applicationInfo \|\| null,\s*normalized\.rawFields,\s*templateJob,\s*args\.formTemplateTally,?\s*\)/.test(body),
    "buildJobRows fills applicationInfo with the row's job and the run's tally",
  );
  assert(
    /const templateJob = \{ externalJobId: persistedExternalJobId \|\| null, title, url: normalized\.url \|\| null \};/.test(body),
    "from the persisted id, title and URL, as _formData is",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("applicationInfoTemplate: applicationInfo filled as _formData is, no token text stored");
