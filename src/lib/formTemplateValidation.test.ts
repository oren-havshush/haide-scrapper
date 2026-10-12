// Run: npx tsx src/lib/formTemplateValidation.test.ts
//
// validators.ts accepts a stored form field's {{job.<token>}} template only
// from the closed list (owner, 2026-10-13, LRN-FORM-12), and refuses anything
// else at save with the list in the message, so a typo can never reach a job.

import { updateSiteConfigSchema } from "./validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const config = (value: string, fieldType = "hidden") => ({
  fieldMappings: {},
  pageFlow: [],
  formCapture: {
    formSelector: "form",
    actionUrl: "https://x.test/apply",
    method: "POST",
    fields: [{ name: "job_id", label: "", fieldType, required: false, tagName: "input", value }],
  },
});
const result = (value: string, fieldType?: string) => updateSiteConfigSchema.safeParse(config(value, fieldType));
const message = (value: string) => {
  const r = result(value);
  return r.success ? "" : r.error.issues.map((i) => i.message).join(" | ");
};

for (const ok of [
  "{{job.idNumber}}",
  "{{job.externalJobId}} - {{job.title}}",
  "JB-{{job.idNumber}}",
  "{{job.url}}",
  "{{job.urlNumber}}",
  "{{job.urlParam:jobid}}",
  "a plain constant",
  "",
]) assert(result(ok).success, `accepted: ${JSON.stringify(ok)}`);
assert(result("{{job.title}}", "text").success, "a template is accepted on any field type (a text job-name field)");

for (const bad of ["{{job.salary}}", "{{ job.title }}", "{{job.urlParam}}", "{{job.urlParam:a b}}", "{{job.title}", "x {{other}}"]) {
  assert(!result(bad).success, `refused: ${JSON.stringify(bad)}`);
}
const m = message("{{job.salary}}");
assert(/\{\{job\.salary\}\}/.test(m), `the message names the bad template (got "${m}")`);
assert(/externalJobId, idNumber, title, url, urlNumber, urlParam:<name>/.test(m), `and lists the tokens (got "${m}")`);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("formTemplateValidation: only the closed tokens are saved");
