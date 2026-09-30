// Run: npx tsx worker/lib/formFields.test.ts
//
// addsite2 phase two, step 2a, with the site developer's requirements
// (owner, 2026-10-01). An apply form is captured with:
//   - every hidden input, with its value (the honeypot filter never drops one);
//   - radio groups as ONE field with options (value + label, like a select);
//   - file inputs' accept and multiple;
//   - the form's enctype;
// and every stored _formData carries capturedAt, captureSource ("live" or
// "static") and extractorVersion (2; 1 = the shape from before this change).
// The rules are pure here; the worker's in-page code only gathers raw element
// descriptions (worker/lib/formExtract.ts).

import {
  FORM_EXTRACTOR_VERSION,
  liveFormBlob,
  normalizeFormFields,
  stampFormData,
  staticFormBlob,
  type RawFieldDescriptor,
} from "./formFields";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const hidden = (name: string, value: string, hpHint = name): RawFieldDescriptor => ({
  tag: "input", type: "hidden", name, label: "", required: false, value, hpHint,
});

// The medulla case (Elementor), plus the developer's field kinds.
const MEDULLA: RawFieldDescriptor[] = [
  hidden("post_id", "18642"),
  hidden("form_id", "723b7d"),
  hidden("queried_id", "20417"),
  hidden("form_fields[Job]", "Lab Technician"),
  hidden("_wpnonce", "a1b2c3d4e5"),
  hidden("hp_email_confirm", "", "hp_email_confirm hp-field"),
  { tag: "input", type: "text", name: "form_fields[name]", label: "שם מלא", required: true, hpHint: "form_fields[name]" },
  { tag: "input", type: "text", name: "hp_website", label: "", required: false, hpHint: "hp_website", offscreen: true },
  { tag: "input", type: "radio", name: "form_fields[shift]", label: "בוקר", required: true, value: "morning", groupLabel: "משמרת" },
  { tag: "input", type: "radio", name: "form_fields[shift]", label: "ערב", required: false, value: "evening", groupLabel: "משמרת" },
  { tag: "input", type: "file", name: "form_fields[cv]", label: "קורות חיים", required: true, accept: ".pdf,.doc,.docx", multiple: true },
  { tag: "select", type: "select", name: "form_fields[city]", label: "עיר", required: false, options: [{ value: "", label: "בחר" }, { value: "haifa", label: "חיפה" }] },
  { tag: "input", type: "submit", name: "", label: "שלח", required: false },
];

eq(FORM_EXTRACTOR_VERSION, 2, "the extractor version is 2 (1 = the shape before this change)");

// --- the fields --------------------------------------------------------------------
{
  const f = normalizeFormFields(MEDULLA);
  const byName = new Map(f.map((x) => [x.name, x]));
  for (const [name, value] of [["post_id", "18642"], ["form_id", "723b7d"], ["queried_id", "20417"], ["form_fields[Job]", "Lab Technician"], ["_wpnonce", "a1b2c3d4e5"]]) {
    eq(byName.get(name)?.value, value, `hidden ${name} is kept with its value`);
  }
  assert(byName.has("hp_email_confirm"), "a honeypot-named HIDDEN input is kept — the filter never drops a hidden input");
  eq(byName.get("hp_email_confirm")?.value, "", "with its (empty) value");
  assert(!byName.has("hp_website"), "a visible honeypot field is still dropped");
  assert(!f.some((x) => x.fieldType === "submit"), "submit, button, reset and image inputs are skipped");

  const radios = f.filter((x) => x.name === "form_fields[shift]");
  eq(radios.length, 1, "a radio group is ONE field");
  eq(radios[0]?.fieldType, "radio", "of type radio");
  eq(radios[0]?.options, [{ value: "morning", label: "בוקר" }, { value: "evening", label: "ערב" }], "with its options, value plus label, like a select");
  eq(radios[0]?.label, "משמרת", "labelled by its group");
  eq(radios[0]?.required, true, "required when any of its inputs is");
  assert(radios[0]?.value === undefined, "and no single value of its own");

  const cv = byName.get("form_fields[cv]");
  eq([cv?.accept, cv?.multiple], [".pdf,.doc,.docx", true], "a file input keeps accept and multiple");
  eq(byName.get("form_fields[city]")?.options?.length, 2, "select options are kept as before");
  eq(f.map((x) => x.name).slice(0, 2), ["post_id", "form_id"], "fields stay in document order");
  assert(byName.get("form_fields[name]")?.value === undefined, "a visible text field carries no value");
}

// --- the blob and its three keys ------------------------------------------------------
{
  const now = new Date("2026-10-01T09:30:00.000Z");
  const blob = JSON.parse(liveFormBlob({ actionUrl: "https://medulla.test/wp-admin/admin-ajax.php", method: "POST", enctype: "multipart/form-data" }, normalizeFormFields(MEDULLA), now));
  eq(blob.enctype, "multipart/form-data", "the form's enctype is kept");
  eq([blob.capturedAt, blob.captureSource, blob.extractorVersion], ["2026-10-01T09:30:00.000Z", "live", 2], "a live capture is stamped live, now, version 2");
  eq(blob.fields.length, 10, "with every field (6 hidden, name, one radio group, CV, city)");
  const noEnctype = JSON.parse(liveFormBlob({ actionUrl: "a", method: "GET", enctype: null }, [], now));
  assert(!("enctype" in noEnctype), "no enctype attribute, no enctype key — never a guessed default");

  const cfg = { formSelector: "form", actionUrl: "https://x.test/apply", method: "POST", enctype: "multipart/form-data", fields: [{ name: "a", label: "A", fieldType: "text", required: false, tagName: "input" }] };
  const st = JSON.parse(staticFormBlob(cfg, "2026-06-09T19:46:13.455Z") ?? "{}");
  eq([st.capturedAt, st.captureSource, st.extractorVersion], ["2026-06-09T19:46:13.455Z", "static", 2], "the static blob carries the config's savedAt, static, version 2");
  eq([st.actionUrl, st.method, st.enctype, st.fields.length], ["https://x.test/apply", "POST", "multipart/form-data", 1], "and the saved form");
  eq(staticFormBlob({ ...cfg, fields: [] }, "x"), null, "no saved fields, no static blob — as before");
}

// --- stamping what came from elsewhere ----------------------------------------------------
{
  const old = JSON.stringify({ actionUrl: "a", method: "POST", fields: [] });
  const s = JSON.parse(stampFormData(old, "2026-10-01T00:05:00.000Z"));
  eq([s.extractorVersion, s.captureSource, s.capturedAt], [1, "live", "2026-10-01T00:05:00.000Z"], "an unstamped blob (an old setupScript's) is stamped version 1");
  const current = liveFormBlob({ actionUrl: "a", method: "GET" }, [], new Date("2026-09-01T00:00:00Z"));
  eq(stampFormData(current, "2026-10-01T00:05:00.000Z"), current, "a stamped blob is left exactly as it is");
  eq(stampFormData("not json", "x"), "not json", "text that is not a JSON object is left alone");
  eq(stampFormData("[1,2]", "x"), "[1,2]", "and so is an array");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("formFields: hidden values, radio groups, file accept/multiple, enctype; every blob stamped");
