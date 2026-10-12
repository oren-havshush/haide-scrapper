// Run: npx tsx worker/lib/formTemplate.test.ts
//
// The per-field value template (owner, 2026-10-13, LRN-FORM-12). A site-wide
// stored form can carry per-job values: a field's stored value may contain
// {{job.<token>}}, alone or inside literal text, from a closed list:
// externalJobId, idNumber, title, url, urlNumber, urlParam:<name>. Filled per
// job at scrape time on a static form only. A token that resolves to nothing
// leaves the field EMPTY and is reported; a job never receives another job's
// value. The public site sees the same blob shape with concrete values.

import { fillFormTemplate, resolveTemplateToken, templateTokenErrors, TEMPLATE_TOKENS, type TemplateJob } from "./formTemplate";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const eq = (got: unknown, want: unknown, msg: string) => assert(JSON.stringify(got) === JSON.stringify(want), `${msg} (got ${JSON.stringify(got)})`);

assert(
  JSON.stringify([...TEMPLATE_TOKENS]) === JSON.stringify(["externalJobId", "idNumber", "title", "url", "urlNumber", "urlParam"]),
  "the closed token list",
);

// --- the syntax: what validators.ts will accept --------------------------------------------
eq(templateTokenErrors("{{job.title}}"), [], "a token alone");
eq(templateTokenErrors("{{job.externalJobId}} - {{job.title}}"), [], "tokens inside literal text (allegronet)");
eq(templateTokenErrors("{{job.urlParam:jobid}}"), [], "urlParam with a name");
eq(templateTokenErrors("no template here"), [], "plain text");
eq(templateTokenErrors("{{job.salary}}"), ["{{job.salary}}"], "an unknown token is an error");
eq(templateTokenErrors("{{ job.title }}"), ["{{ job.title }}"], "spaces inside the braces are not the syntax");
eq(templateTokenErrors("{{job.urlParam}}"), ["{{job.urlParam}}"], "urlParam needs a name");
eq(templateTokenErrors("{{job.urlParam:a b}}"), ["{{job.urlParam:a b}}"], "a urlParam name with a space");
eq(templateTokenErrors("{{job.urlParam:" + "x".repeat(41) + "}}"), ["{{job.urlParam:" + "x".repeat(41) + "}}"], "a urlParam name over 40 characters");
eq(templateTokenErrors("{{job.title}"), ["{{job.title}"], "an unclosed template");
eq(templateTokenErrors("{{job.title}} and {{other}}"), ["{{other}}"], "each bad one is named");

// --- the tokens -------------------------------------------------------------------------------
const job: TemplateJob = {
  externalJobId: "l-b-12230",
  title: "Bookkeeper (part time)",
  url: "https://l-b.co.il/job/12230?ref=7&jobid=20414011",
};
eq(resolveTemplateToken("externalJobId", null, job), "l-b-12230", "externalJobId");
eq(resolveTemplateToken("idNumber", null, job), "12230", "idNumber: the last run of digits in the id");
eq(resolveTemplateToken("idNumber", null, { ...job, externalJobId: "JB-657" }), "657", "idNumber of JB-657");
eq(resolveTemplateToken("title", null, job), "Bookkeeper (part time)", "title");
eq(resolveTemplateToken("url", null, job), job.url, "url");
eq(resolveTemplateToken("urlNumber", null, job), "20414011", "urlNumber: the last run of digits in the URL");
eq(resolveTemplateToken("urlParam", "jobid", job), "20414011", "urlParam:jobid");
eq(resolveTemplateToken("urlParam", "missing", job), null, "an absent parameter resolves to nothing");
eq(resolveTemplateToken("idNumber", null, { ...job, externalJobId: "h-1oc63x2" }), "2", "a hashed id still yields its last digits (which is why each site gets a page check first)");
eq(resolveTemplateToken("idNumber", null, { ...job, externalJobId: "simplyclub-abc" }), null, "no digits: nothing");
eq(resolveTemplateToken("externalJobId", null, { ...job, externalJobId: null }), null, "no id: nothing");
eq(resolveTemplateToken("url", null, { ...job, url: null }), null, "no url: nothing");

// --- the fill ---------------------------------------------------------------------------------
const blob = (captureSource: string, fields: Array<Record<string, unknown>>) =>
  JSON.stringify({ actionUrl: "https://l-b.co.il/apply", method: "POST", fields, capturedAt: "2026-10-13T10:00:00.000Z", captureSource, extractorVersion: 4 });
const fields = [
  { name: "job_id", label: "", fieldType: "hidden", required: false, tagName: "input", value: "{{job.idNumber}}" },
  { name: "job_name", label: "", fieldType: "hidden", required: false, tagName: "input", value: "{{job.externalJobId}} - {{job.title}}" },
  { name: "fullname", label: "Name", fieldType: "text", required: true, tagName: "input" },
  { name: "form_id", label: "", fieldType: "hidden", required: false, tagName: "input", value: "15" },
];
{
  const r = fillFormTemplate(blob("static", fields), job);
  const out = JSON.parse(r.blob) as { fields: Array<{ name: string; value?: string }>; captureSource: string; extractorVersion: number };
  eq(out.fields.map((f) => [f.name, f.value ?? null]), [
    ["job_id", "12230"],
    ["job_name", "l-b-12230 - Bookkeeper (part time)"],
    ["fullname", null],
    ["form_id", "15"],
  ], "a static form's templates are filled with this job's values; other fields untouched");
  eq(Object.keys(JSON.parse(r.blob)), Object.keys(JSON.parse(blob("static", fields))), "the blob keeps its shape and key order");
  assert(out.captureSource === "static" && out.extractorVersion === 4, "captureSource and extractorVersion unchanged");
  assert(!/\{\{/.test(r.blob), "no template text reaches the stored blob");
  eq(r.unfilled, [], "nothing unfilled");
}
// Two jobs from the same site-wide blob each get their own values.
{
  const site = blob("static", fields);
  const a = JSON.parse(fillFormTemplate(site, job).blob).fields[0].value;
  const b = JSON.parse(fillFormTemplate(site, { ...job, externalJobId: "l-b-58118" }).blob).fields[0].value;
  assert(a === "12230" && b === "58118", `each job its own value (got ${a}, ${b})`);
}
// A token that resolves to nothing: the field is EMPTY and reported, never another job's value.
{
  const r = fillFormTemplate(blob("static", fields), { ...job, externalJobId: null });
  const out = JSON.parse(r.blob).fields as Array<{ name: string; value?: string }>;
  eq(out[0].value, "", "job_id is left empty");
  eq(out[1].value, "", "job_name is left empty, not half-filled");
  eq(r.unfilled, ["job_id (idNumber)", "job_name (externalJobId)"], "each unfilled field is named with its token");
}
// A live or script-written form is left alone, template text and all.
{
  const live = blob("live", fields);
  eq(fillFormTemplate(live, job), { blob: live, unfilled: [] }, "a live form is left exactly as it is");
  const script = blob("script", fields);
  eq(fillFormTemplate(script, job), { blob: script, unfilled: [] }, "a script-written form is left exactly as it is");
  eq(fillFormTemplate("not json", job), { blob: "not json", unfilled: [] }, "an unreadable blob is left as it is");
  const plain = blob("static", [fields[2], fields[3]]);
  eq(fillFormTemplate(plain, job), { blob: plain, unfilled: [] }, "a static form with no template is returned byte for byte");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("formTemplate: the closed tokens, filled per job on a static form only, empty when unresolved");
