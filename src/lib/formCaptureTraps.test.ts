// Run: npx tsx src/lib/formCaptureTraps.test.ts
//
// Report fixes 3, item 4 (2026-10-21, the developer's 10-20 reply, item 4): the
// shared template writes honeypots and prefilled into a capture, but the strict
// formCapture schema knew neither, so a PUT carrying them was a 400
// (Unrecognized key: "honeypots"). Now honeypots is an optional array of
// strings at the top level and prefilled an optional boolean on a field, and
// staticFormBlob passes both to the job blob with the live capture's meaning
// (version 5).

import { configIssueMessage, updateSiteConfigSchema } from "./validators";
import { FORM_EXTRACTOR_VERSION, staticFormBlob } from "../../worker/lib/formFields";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const formCapture = {
  formSelector: "form.wpcf7-form",
  actionUrl: "https://x.example/contact/",
  method: "POST",
  honeypots: ["website"],
  fields: [
    { name: "your-name", label: "שם מלא", fieldType: "text", required: true, tagName: "input" },
    { name: "job-title", label: "משרה", fieldType: "text", required: false, tagName: "input", value: "{{job.title}}", prefilled: true },
  ],
};
const body = {
  itemSelector: ".job",
  fieldMappings: { title: { selector: "h2", source: "MANUAL", confidence: 100 } },
  pageFlow: [{ url: "https://x.example/jobs", action: "navigate" }],
  formCapture,
};

{
  const r = updateSiteConfigSchema.safeParse(body);
  const why = r.success ? "" : r.error.issues.map(configIssueMessage).join(", ");
  assert(r.success, `a capture with honeypots and a prefilled field parses (got ${why})`);
  if (r.success) {
    const fc = r.data.formCapture as { honeypots?: string[]; fields: Array<{ prefilled?: boolean }> } | null;
    assert(JSON.stringify(fc?.honeypots) === JSON.stringify(["website"]), "honeypots is kept, not stripped");
    assert(fc?.fields[1]?.prefilled === true && fc?.fields[0]?.prefilled === undefined, "prefilled is kept on its field only");
  }
}
{
  // Still strict: the wrong type is refused, and so is a key nobody defined.
  const bad = (fc: unknown) => !updateSiteConfigSchema.safeParse({ ...body, formCapture: fc }).success;
  assert(bad({ ...formCapture, honeypots: "website" }), "honeypots as a string is refused");
  assert(bad({ ...formCapture, honeypots: [1] }), "honeypots of numbers is refused");
  assert(bad({ ...formCapture, fields: [{ ...formCapture.fields[1], prefilled: "yes" }] }), "prefilled as a string is refused");
  assert(bad({ ...formCapture, trapFields: [] }), "an unknown key is still refused");
}
{
  const blob = JSON.parse(staticFormBlob(formCapture, "2026-10-21T08:00:00.000Z") ?? "{}");
  assert(JSON.stringify(blob.honeypots) === JSON.stringify(["website"]), "the static blob carries honeypots");
  assert(blob.fields?.[1]?.prefilled === true && blob.fields?.[1]?.value === "{{job.title}}", "and the prefilled field with its value");
  assert(blob.extractorVersion === FORM_EXTRACTOR_VERSION && FORM_EXTRACTOR_VERSION === 5, "version 5");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("formCaptureTraps: honeypots and prefilled are saved and reach the static blob");
