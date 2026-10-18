// Run: npx tsx worker/lib/formHoneypots.test.ts
//
// R8 (2026-10-18, from the public-site developer): CallBiz carries a Contact
// Form 7 honeypot that none of our checks saw. The input is full-size and
// visible by its own style; a 1 px clipped wrapper hides it, the wrapper's
// class names it, and a label beside it says "Please leave this field empty."
//   a. a field hidden by an ancestor below the form is style-hidden;
//   b. the ancestors' classes and ids join the trap-word hint, and a label or
//      placeholder asking that the field be left empty marks a trap;
//   c. a trap stays out of fields and is named in a top-level honeypots array
//      (live and static paths, version 5), and applyHoneypotField reads it.
// Both capture paths run on the page: the live extractor and the template.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { extractLiveFormData } from "./formExtract";
import { asksToLeaveEmpty, FORM_EXTRACTOR_VERSION, normalizeFormFieldsWithTraps, staticFormBlob, type RawFieldDescriptor } from "./formFields";
import { applyHoneypotField } from "./valueChecks";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// CallBiz's markup, as the public-site developer read it on 2026-10-18.
const CALLBIZ_FORM = `<form class="wpcf7-form" method="post" action="/contact/#wpcf7-f12-p34-o1">
  <input type="hidden" name="_wpcf7" value="12">
  <p><label>שם מלא<input type="text" name="your-name" class="wpcf7-text"></label></p>
  <p><label>טלפון<input type="tel" name="your-phone" class="wpcf7-tel"></label></p>
  <span class="cf7apps-honeypot-wrap" style="position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0)">
    <label>Please leave this field empty.</label>
    <input type="text" name="email" placeholder="email" autocomplete="new-password" tabindex="1000">
  </span>
  <span class="field-wrap"><input type="email" name="your-email" placeholder="אימייל"></span>
  <span class="cv-wrap" style="position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0)"><input type="file" name="cv"></span>
  <button type="submit">שלח</button>
</form>`;
// The same wrapper with a neutral class and no label: hidden only by the wrapper's style.
const WRAPPER_ONLY = `<form class="f2" method="post" action="/x">
  <input type="text" name="full_name">
  <span class="w" style="position:absolute; width:1px; height:1px; overflow:hidden"><input type="text" name="email2"></span>
  <div style="clip-path: inset(50%)"><input type="text" name="email3"></div>
  <div style="display:none"><input type="text" name="email4"></div>
</form>`;

/** A page served at `url` with `body`. Nothing leaves the machine. */
async function serve(page: Page, url: string, body: string): Promise<void> {
  const origin = new URL(url).origin;
  await page.unroute("**/*");
  await page.route(`${origin}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
  await page.goto(url);
}
const TEMPLATE = readFileSync(join(__dirname, "..", "..", "sites", "_shared", "form-capture-template.js"), "utf8").split("__ITEMSEL__").join(".job");
type Blob = { fields: Array<{ name: string }>; honeypots?: string[]; extractorVersion?: number };

async function bothPaths(page: Page, formSelector: string): Promise<{ live: Blob | null; template: Blob | null }> {
  const live = await extractLiveFormData(page, { formSelector }, new Date("2026-10-18T12:00:00Z"));
  await page.evaluate(TEMPLATE);
  const span = await page.evaluate(() => document.querySelector("[data-extracted-form]")?.textContent ?? null);
  return { live: live ? JSON.parse(live) : null, template: span ? JSON.parse(span) : null };
}

// --- the rules, pure ----------------------------------------------------------------------
{
  assert(asksToLeaveEmpty("Please leave this field empty.") && asksToLeaveEmpty("Leave the field blank") && asksToLeaveEmpty("Do not fill this in"), "the English leave-empty wordings");
  assert(asksToLeaveEmpty("נא לא למלא שדה זה") && asksToLeaveEmpty("השאר שדה זה ריק"), "the Hebrew ones");
  assert(!asksToLeaveEmpty("email") && !asksToLeaveEmpty("Full name") && !asksToLeaveEmpty(""), "an ordinary label is not");
  const d = (over: Partial<RawFieldDescriptor>): RawFieldDescriptor => ({ tag: "input", type: "text", name: "f", label: "f", required: false, ...over });
  const r = normalizeFormFieldsWithTraps([
    d({ name: "your-name" }),
    d({ name: "email", label: "email", placeholder: "email", nearLabel: "Please leave this field empty." }),
    d({ name: "email_wrap", hpHint: "email_wrap  cf7apps-honeypot-wrap" }),
    d({ name: "cv", type: "file", styleHidden: true }),
  ]);
  assert(JSON.stringify(r.fields.map((f) => f.name)) === JSON.stringify(["your-name", "cv"]), `traps out of fields, a file input kept (got ${JSON.stringify(r.fields.map((f) => f.name))})`);
  assert(JSON.stringify(r.honeypots) === JSON.stringify(["email", "email_wrap"]), `traps named in honeypots (got ${JSON.stringify(r.honeypots)})`);
}

// --- the static path passes the capture's honeypots through -----------------------------------
{
  const fc = { actionUrl: "https://callbiz.test/contact", method: "POST", fields: [{ name: "your-name", label: "", fieldType: "text", required: true, tagName: "input" }], honeypots: ["email"] };
  const st = JSON.parse(staticFormBlob(fc, "2026-10-18T10:00:00.000Z") ?? "{}");
  assert(JSON.stringify(st.honeypots) === JSON.stringify(["email"]) && st.extractorVersion === FORM_EXTRACTOR_VERSION && FORM_EXTRACTOR_VERSION === 5, "static: honeypots passed through, version 5");
  const noHp = JSON.parse(staticFormBlob({ ...fc, honeypots: undefined }, null) ?? "{}");
  assert(!("honeypots" in noHp), "static: a capture without honeypots gets no key");
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await serve(page, "https://callbiz.test/contact/", `<!doctype html><html><body><div class="job">${CALLBIZ_FORM}</div></body></html>`);
    const callbiz = await bothPaths(page, "form.wpcf7-form");
    for (const [who, blob] of [["live extractor", callbiz.live], ["capture template", callbiz.template]] as const) {
      const names = (blob?.fields ?? []).map((f) => f.name);
      assert(!names.includes("email"), `${who}: CallBiz's honeypot "email" is not in fields (got ${JSON.stringify(names)})`);
      assert((blob?.honeypots ?? []).includes("email"), `${who}: it is named in honeypots (got ${JSON.stringify(blob?.honeypots)})`);
      assert(names.includes("your-name") && names.includes("your-phone") && names.includes("your-email"), `${who}: the real fields stay, the one in an ordinary wrapper too`);
      assert(names.includes("cv"), `${who}: a file input in a clipped wrapper stays (TEXT_LIKE)`);
    }
    assert(callbiz.live?.extractorVersion === 5, "the live blob is version 5");

    // The check fires on the stored blob, naming "email".
    const check = applyHoneypotField([{ key: "callbiz-1", formData: JSON.stringify(callbiz.live) }]);
    assert(!!check && /apply_honeypot_field: 1 job\(s\) captured a honeypot field \(email\) — a submit must leave it empty/.test(check.warning), `applyHoneypotField names "email" (got ${check?.warning})`);

    // Hidden by the wrapper's style alone: a 1 px box with overflow hidden, clip-path inset(50%), display none.
    await serve(page, "https://wrap.test/jobs/1", `<!doctype html><html><body><div class="job">${WRAPPER_ONLY}</div></body></html>`);
    const wrap = await bothPaths(page, "form.f2");
    for (const [who, blob] of [["live extractor", wrap.live], ["capture template", wrap.template]] as const) {
      const names = (blob?.fields ?? []).map((f) => f.name);
      assert(JSON.stringify(names) === JSON.stringify(["full_name"]), `${who}: fields hidden by an ancestor are dropped (got ${JSON.stringify(names)})`);
      assert(JSON.stringify(blob?.honeypots) === JSON.stringify(["email2", "email3", "email4"]), `${who}: and named (got ${JSON.stringify(blob?.honeypots)})`);
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("formHoneypots: a field hidden by its wrapper or labelled leave-empty is a trap, named in honeypots on both paths; the check names it");
})().catch((e) => {
  console.error(`FAIL: formHoneypots test threw — ${(e as Error).message}`);
  process.exit(1);
});
