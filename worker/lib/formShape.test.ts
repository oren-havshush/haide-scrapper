// Run: npx tsx worker/lib/formShape.test.ts
//
// The second half of the form change (owner, 2026-10-01; names fixed by the
// public-site developer): every _formData carries actionAttribute, pageUrl,
// actionUrl (today's meaning), submitMechanism and shapeHash, and a blob a
// setup script injected as applicationInfo is stamped captureSource "script".
// The mechanism rules on real fleet markup (kahane, anvei-zion's Contact Form 7,
// rad's Gravity Forms) run in a real browser in worker/lib/formExtract.test.ts;
// this file holds the pure rules, medulla's saved static form, the frameworks
// the fleet has no live example of (WPForms, Ninja Forms), the hash, and the
// script stamp.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  completeFormBlob,
  detectSubmitMechanism,
  formShapeHash,
  resolveActionAttribute,
  stampScriptFormBlob,
  type ShapeField,
} from "./formShape";
import { FORM_EXTRACTOR_VERSION } from "./formFields";
import { normalizeJobRecord } from "./normalizer";

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

const PAGE = "https://www.example.co.il/jobs/driver/";

// --- actionAttribute ---------------------------------------------------------------
eq(resolveActionAttribute(null, PAGE), "", "no action attribute: empty, never the page URL");
eq(resolveActionAttribute("", PAGE), "", "an empty action attribute: empty");
eq(resolveActionAttribute("   ", PAGE), "", "a blank action attribute: empty");
eq(resolveActionAttribute("/send.php", PAGE), "https://www.example.co.il/send.php", "a relative action resolves against the page");
eq(resolveActionAttribute("#wpcf7-f10-o1", PAGE), "https://www.example.co.il/jobs/driver/#wpcf7-f10-o1", "a fragment-only action resolves against the page");
eq(resolveActionAttribute("https://other.example/x", PAGE), "https://other.example/x", "an absolute action stays");

// --- mechanism rules the fleet has no live page for ---------------------------------
const f = (name: string, fieldType = "text", value?: string): ShapeField => ({
  name,
  fieldType,
  tagName: "input",
  ...(value !== undefined ? { value } : {}),
});

// WPForms, as its own markup renders: class wpforms-form (+ wpforms-ajax-form when
// AJAX submission is on), hidden wpforms[id] and wpforms[post_id].
const wpFields = [f("wpforms[fields][1]"), f("wpforms[id]", "hidden", "123"), f("wpforms[post_id]", "hidden", "45")];
eq(
  detectSubmitMechanism({ actionAttribute: "https://www.example.co.il/careers/", pageUrl: PAGE, formClass: "wpforms-validate wpforms-form wpforms-ajax-form", fields: wpFields }),
  { submitMechanism: "ajax", submitEndpoint: "https://www.example.co.il/wp-admin/admin-ajax.php", submitAction: "wpforms_submit" },
  "WPForms with AJAX on: ajax to admin-ajax.php, action wpforms_submit",
);
eq(
  detectSubmitMechanism({ actionAttribute: "https://www.example.co.il/careers/", pageUrl: PAGE, formClass: "wpforms-validate wpforms-form", fields: wpFields }),
  { submitMechanism: "native_form" },
  "WPForms with AJAX off: a native post to its action",
);
eq(
  detectSubmitMechanism({ actionAttribute: "https://www.example.co.il/careers/", pageUrl: PAGE, fields: wpFields }),
  { submitMechanism: "unknown" },
  "WPForms seen without its class (a saved or script blob): AJAX on or off cannot be told, so unknown",
);

// Ninja Forms renders its fields as nf-field-<n>; it always submits through admin-ajax.php.
eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, fields: [f("nf-field-5"), f("nf-field-6", "email")] }),
  { submitMechanism: "ajax", submitEndpoint: "https://www.example.co.il/wp-admin/admin-ajax.php", submitAction: "nf_ajax_submit" },
  "Ninja Forms: ajax to admin-ajax.php, action nf_ajax_submit",
);

// Contact Form 7 whose _wpcf7 value was not kept: the id comes from the unit tag.
eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, fields: [f("_wpcf7", "hidden", ""), f("_wpcf7_unit_tag", "hidden", "wpcf7-f463-o1"), f("your-name")] }),
  { submitMechanism: "ajax", submitEndpoint: "https://www.example.co.il/wp-json/contact-form-7/v1/contact-forms/463/feedback" },
  "Contact Form 7: the form id from the unit tag when _wpcf7 carries no value",
);
eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, fields: [f("_wpcf7", "hidden"), f("your-name")] }),
  { submitMechanism: "ajax" },
  "Contact Form 7 with no form id anywhere: ajax, and no endpoint rather than a guessed one",
);

// No recognised framework.
eq(
  detectSubmitMechanism({ actionAttribute: "https://www.example.co.il/apply.php", pageUrl: PAGE, formClass: "apply", fields: [f("name"), f("cv", "file")] }),
  { submitMechanism: "native_form" },
  "a plain form with an action: native_form",
);
eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, formClass: "job-send-email", fields: [f("action", "hidden", "noo_ajax_job_send_email"), f("email")] }),
  { submitMechanism: "unknown" },
  "a plain form with no action (medulla's noo send-email form): unknown, no endpoint",
);

// Elementor: the hidden post_id is not enough when it is not hidden.
eq(
  detectSubmitMechanism({ actionAttribute: "", pageUrl: PAGE, fields: [f("post_id", "text"), f("email")] }),
  { submitMechanism: "unknown" },
  "a visible field named post_id is not Elementor's marker",
);

// --- medulla: the real saved static form ----------------------------------------------
const medullaCapture = JSON.parse(readFileSync(join(__dirname, "fixtures", "forms", "medulla-formcapture.json"), "utf8"));
const medullaStatic = JSON.stringify({
  actionUrl: medullaCapture.actionUrl,
  method: medullaCapture.method,
  fields: medullaCapture.fields,
  capturedAt: "2026-09-28T09:56:58.031Z",
  captureSource: "static",
  extractorVersion: FORM_EXTRACTOR_VERSION,
});
const medulla = JSON.parse(completeFormBlob(medullaStatic, { pageUrl: "https://medulla.co.il/new-jobs/", actionAttribute: "" }));
eq(
  [medulla.submitMechanism, medulla.submitEndpoint, medulla.submitAction],
  ["ajax", "https://medulla.co.il/wp-admin/admin-ajax.php", "elementor_pro_forms_send_form"],
  "medulla's saved form (hidden post_id, form_id, queried_id): Elementor, ajax",
);
eq(medulla.pageUrl, "https://medulla.co.il/new-jobs/", "medulla: pageUrl is the page the worker had open");
eq(medulla.actionAttribute, "", "medulla: a saved form's action attribute is not known, so empty (the recorder substitutes the page URL)");
eq(medulla.actionUrl, medullaCapture.actionUrl, "medulla: actionUrl keeps today's meaning");
eq([medulla.captureSource, medulla.capturedAt], ["static", "2026-09-28T09:56:58.031Z"], "medulla: its stamps are kept");
assert(/^[0-9a-f]{40}$/.test(medulla.shapeHash ?? ""), `medulla: a sha1 shapeHash (${medulla.shapeHash})`);
eq(medulla.fields.length, medullaCapture.fields.length, "medulla: the fields are unchanged");

// --- shapeHash -------------------------------------------------------------------------
const base: ShapeField[] = [f("post_id", "hidden", "9653"), f("form_fields[email]", "email"), f("form_fields[cv][]", "file")];
const h0 = formShapeHash(base, "", "ajax");
assert(/^[0-9a-f]{40}$/.test(h0), `the hash is sha1 hex (${h0})`);
eq(formShapeHash([{ ...base[0], value: "18642" }, base[1], base[2]], "", "ajax"), h0, "a value change keeps the hash");
eq(formShapeHash([base[2], base[0], base[1]], "", "ajax"), h0, "field order does not change the hash");
eq(formShapeHash(base.map((x) => ({ ...x, tagName: "INPUT" })), "", "ajax"), h0, "tagName case does not change the hash (saved forms say INPUT)");
assert(formShapeHash([...base, f("form_fields[phone]", "tel")], "", "ajax") !== h0, "an added field changes the hash");
assert(formShapeHash(base.slice(0, 2), "", "ajax") !== h0, "a removed field changes the hash");
assert(formShapeHash([f("post_id", "hidden"), f("form_fields[mail]", "email"), base[2]], "", "ajax") !== h0, "a renamed field changes the hash");
assert(formShapeHash([base[0], f("form_fields[email]", "text"), base[2]], "", "ajax") !== h0, "a changed fieldType changes the hash");
assert(formShapeHash(base, "https://x.example/a", "ajax") !== h0, "a changed actionAttribute changes the hash");
assert(formShapeHash(base, "", "native_form") !== h0, "a changed mechanism changes the hash");

// --- completeFormBlob: key set and today's actionUrl -------------------------------------
const live = JSON.parse(
  completeFormBlob(
    JSON.stringify({ actionUrl: PAGE, method: "POST", fields: base, capturedAt: "2026-10-01T09:30:00.000Z", captureSource: "live", extractorVersion: FORM_EXTRACTOR_VERSION }),
    { pageUrl: PAGE, actionAttribute: "", formClass: "elementor-form" },
  ),
);
for (const k of ["actionAttribute", "pageUrl", "actionUrl", "submitMechanism", "shapeHash", "capturedAt", "captureSource", "extractorVersion"]) {
  assert(k in live, `a completed blob carries ${k}`);
}
eq(live.actionUrl, PAGE, "actionUrl keeps today's meaning (the page when the form has no action)");
eq(live.actionAttribute, "", "while actionAttribute stays empty");
eq(live.shapeHash, formShapeHash(base, "", "ajax"), "the blob's shapeHash is formShapeHash over its own fields");
eq(completeFormBlob("mailto:jobs@example.co.il", { pageUrl: PAGE }), "mailto:jobs@example.co.il", "text that is not a form blob is returned as it came");

// --- the script stamp ---------------------------------------------------------------------
const AT = new Date("2026-10-01T23:10:00Z");
// The shape every existing setupScript's copy of the capture template emits today.
const legacyScript = JSON.stringify({ actionUrl: "", method: "POST", fields: [f("post_id", "hidden"), f("form_fields[name]")] });
const s1 = JSON.parse(stampScriptFormBlob(legacyScript, { pageUrl: PAGE, at: AT }));
eq([s1.captureSource, s1.extractorVersion, s1.capturedAt], ["script", 1, "2026-10-01T23:10:00.000Z"], "an old script blob: script, version 1, the scrape's time");
eq([s1.pageUrl, s1.actionAttribute, s1.submitMechanism], [PAGE, "", "ajax"], "an old script blob gains pageUrl, an empty actionAttribute and its mechanism");
assert(/^[0-9a-f]{40}$/.test(s1.shapeHash ?? ""), "an old script blob gains a shapeHash");
// What the updated template emits: its own stamps, pageUrl and actionAttribute.
const newScript = JSON.stringify({
  actionUrl: "https://www.example.co.il/send.php",
  actionAttribute: "https://www.example.co.il/send.php",
  pageUrl: "https://www.example.co.il/jobs/",
  method: "POST",
  fields: [f("name"), f("cv", "file")],
  capturedAt: "2026-10-01T23:09:59.000Z",
  captureSource: "script",
  extractorVersion: FORM_EXTRACTOR_VERSION,
});
const s2 = JSON.parse(stampScriptFormBlob(newScript, { pageUrl: PAGE, at: AT }));
eq([s2.capturedAt, s2.pageUrl, s2.actionAttribute, s2.extractorVersion], ["2026-10-01T23:09:59.000Z", "https://www.example.co.il/jobs/", "https://www.example.co.il/send.php", FORM_EXTRACTOR_VERSION], "a new script blob keeps its own capturedAt, pageUrl, actionAttribute and version");
eq([s2.captureSource, s2.submitMechanism], ["script", "native_form"], "and is script, native_form");
// A blob stamped live by a template copy from step 2a is still a script's blob.
const s3 = JSON.parse(stampScriptFormBlob(JSON.stringify({ ...JSON.parse(newScript), captureSource: "live" }), { pageUrl: PAGE, at: AT }));
eq(s3.captureSource, "script", "a script blob that called itself live is restamped script");
eq(stampScriptFormBlob("mailto:jobs@example.co.il", { pageUrl: PAGE, at: AT }), "mailto:jobs@example.co.il", "an applicationInfo that is not a form blob is untouched");
eq(stampScriptFormBlob(`{"note":"x"}`, { pageUrl: PAGE, at: AT }), `{"note":"x"}`, "JSON without a fields array is untouched");

// --- the normalizer stamps the explicit field ----------------------------------------------
const n1 = normalizeJobRecord({ title: "Driver", applicationInfo: legacyScript, _detailUrl: PAGE }, { at: AT });
const a1 = JSON.parse(n1.applicationInfo);
eq([a1.captureSource, a1.pageUrl], ["script", PAGE], "normalizeJobRecord stamps an explicit applicationInfo blob script, with the job's page");
const n2 = normalizeJobRecord({ title: "Driver", applicationInfo: "mailto:jobs@example.co.il" }, { at: AT });
eq(n2.applicationInfo, "mailto:jobs@example.co.il", "an explicit plain-text applicationInfo is unchanged");
const liveBlob = completeFormBlob(
  JSON.stringify({ actionUrl: PAGE, method: "POST", fields: base, capturedAt: "2026-10-01T09:30:00.000Z", captureSource: "live", extractorVersion: FORM_EXTRACTOR_VERSION }),
  { pageUrl: PAGE, actionAttribute: "" },
);
const n3 = normalizeJobRecord({ title: "Driver", _formData: liveBlob }, { at: AT });
eq(n3.applicationInfo, liveBlob, "with no explicit field, applicationInfo is the worker's _formData exactly");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("formShape: actionAttribute, pageUrl, submitMechanism, shapeHash, and the script stamp");
