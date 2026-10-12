// Run: npx tsx worker/lib/formTemplateWiring.test.ts
//
// Where the template is filled (owner, 2026-10-13, LRN-FORM-12): in
// buildJobRows, after extraction, normalisation and the id fallback, on each
// row's own _formData, before it is stamped. A job is filled from its own
// persisted id, title and URL only. Unfilled fields are reported once per
// field and token, with how many jobs: form_template_unfilled: <field> (<token>).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fillRowFormTemplate, formTemplateWarnings } from "./formTemplate";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const site = JSON.stringify({
  actionUrl: "https://x.test/apply",
  method: "POST",
  fields: [{ name: "job_id", label: "", fieldType: "hidden", required: false, tagName: "input", value: "{{job.idNumber}}" }],
  capturedAt: "2026-10-13T10:00:00.000Z",
  captureSource: "static",
  extractorVersion: 4,
});

// Each row is filled from its own values; the tally counts the unfilled.
{
  const tally = new Map<string, number>();
  const rows = [
    { raw: { title: "A", _formData: site }, job: { externalJobId: "x-101", title: "A", url: "https://x.test/j/101" } },
    { raw: { title: "B", _formData: site }, job: { externalJobId: "x-202", title: "B", url: "https://x.test/j/202" } },
    { raw: { title: "C", _formData: site }, job: { externalJobId: null, title: "C", url: null } },
    { raw: { title: "D", _formData: site }, job: { externalJobId: null, title: "D", url: null } },
  ];
  const out = rows.map((r) => fillRowFormTemplate(r.raw, r.job, tally));
  const value = (i: number) => JSON.parse(out[i]._formData).fields[0].value;
  assert(value(0) === "101" && value(1) === "202", `each job its own value (got ${value(0)}, ${value(1)})`);
  assert(value(2) === "" && value(3) === "", "a job with no id gets an empty field");
  assert(out[0].title === "A" && rows[0].raw._formData === site, "the other raw fields are kept, and the input is not mutated");
  const w = formTemplateWarnings(tally);
  assert(JSON.stringify(w) === JSON.stringify(["form_template_unfilled: job_id (idNumber) on 2 job(s)"]), `one warning per field and token, with the count (got ${JSON.stringify(w)})`);
  const none = fillRowFormTemplate({ title: "E" }, rows[0].job, tally);
  assert(!("_formData" in none), "a row with no form is returned as it is");
}

// scrape.ts: buildJobRows fills before stamping, from the persisted id, the
// row's title and its URL, and the run reports the tally on the written path.
{
  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
  const start = src.indexOf("function buildJobRows(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert(
    /rawData: stampRawFormData\(\s*fillRowFormTemplate\(\s*normalized\.rawFields,\s*\{ externalJobId: persistedExternalJobId \|\| null, title, url: normalized\.url \|\| null \},\s*args\.formTemplateTally,?\s*\),\s*args\.seenAt,?\s*\)/.test(body),
    "buildJobRows fills the row's own form, from its persisted id, title and URL, before stamping",
  );
  assert(/formTemplateTally,/.test(src.slice(src.indexOf("const rows = buildJobRows({"), src.indexOf("const rows = buildJobRows({") + 600)), "the run passes its tally");
  assert(/scrapeWarnings\.push\(\.\.\.formTemplateWarnings\(formTemplateTally\)\);/.test(src), "and reports it on the written run");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("formTemplateWiring: each row filled from its own values in buildJobRows, unfilled fields reported");
