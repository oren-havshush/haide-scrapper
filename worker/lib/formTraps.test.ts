// Run: npx tsx worker/lib/formTraps.test.ts
//
// H4 (owner, 2026-10-14): two more trap patterns. A text-like field hidden by
// its own style (display none, visibility hidden, opacity 0, zero size, far
// off-screen, aria-hidden with tabindex -1), a field a script empties on load,
// and a field named for a trap (malkodet) are captured and never filled: they
// are left out of the stored form's fields, as a honeypot always was. A hidden
// input is never dropped, and a radio, checkbox or file input hidden behind a
// styled control stays a real field.
//
// Real markup, as served on 2026-10-14: Comblack's malkodetdvash, Prologic's
// message (hidden by main.css .info-r) and emailHidden (off-screen, 1px,
// opacity 0, aria-hidden). Both capture paths are run on each page: the
// worker's live extractor and the shared capture template.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { extractLiveFormData } from "./formExtract";
import { HONEYPOT_NAME, normalizeFormFields, type RawFieldDescriptor } from "./formFields";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- the rules, pure -------------------------------------------------------------------
{
  const d = (over: Partial<RawFieldDescriptor>): RawFieldDescriptor => ({ tag: "input", type: "text", name: "f", label: "f", required: false, ...over });
  const names = (ds: RawFieldDescriptor[]) => normalizeFormFields(ds).map((f) => f.name);
  const kept = names([
    d({ name: "malkodetdvash" }),
    d({ name: "message", tag: "textarea", type: "textarea", styleHidden: true }),
    d({ name: "emailHidden", styleHidden: true }),
    d({ name: "nameCopy", emptiedOnLoad: true }),
    d({ name: "firstname9" }),
    d({ name: "hidden_trap", type: "hidden", styleHidden: true, emptiedOnLoad: true, value: "" }),
    d({ name: "accept_terms", type: "checkbox", styleHidden: true }),
    d({ name: "cv", type: "file", styleHidden: true }),
  ]);
  assert(!kept.includes("malkodetdvash"), "a field named for a trap (malkodet) is dropped");
  assert(!kept.includes("message") && !kept.includes("emailHidden"), "a text-like field hidden by its own style is dropped");
  assert(!kept.includes("nameCopy"), "a field a script emptied on load is dropped");
  assert(kept.includes("firstname9"), "an ordinary text field stays");
  assert(kept.includes("hidden_trap"), "a hidden input is never dropped");
  assert(kept.includes("accept_terms") && kept.includes("cv"), "a checkbox or file input hidden behind a styled control stays");
  assert(HONEYPOT_NAME.test("malkodetdvash") && !HONEYPOT_NAME.test("email9"), "the name rule knows malkodet, and not an ordinary name");
}

/** A page served at `url` with `body`. Nothing leaves the machine. */
async function serve(page: Page, url: string, body: string): Promise<void> {
  const origin = new URL(url).origin;
  await page.unroute("**/*");
  await page.route(`${origin}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
  await page.goto(url);
}
async function serveFixture(page: Page, file: string): Promise<void> {
  const src = readFileSync(join(__dirname, "fixtures", "forms", file), "utf8");
  await serve(page, /^<!-- (\S+) -->/.exec(src)?.[1] ?? "", `<!doctype html><html><body><div class="job">${src}</div></body></html>`);
}
const TEMPLATE = readFileSync(join(__dirname, "..", "..", "sites", "_shared", "form-capture-template.js"), "utf8").split("__ITEMSEL__").join(".job");

/** The field names each capture path keeps for the form on the page. */
async function bothPaths(page: Page, formSelector: string): Promise<{ live: string[]; template: string[] }> {
  const live = await extractLiveFormData(page, { formSelector }, new Date("2026-10-14T12:00:00Z"));
  await page.evaluate(TEMPLATE);
  const span = await page.evaluate(() => document.querySelector("[data-extracted-form]")?.textContent ?? null);
  const names = (blob: string | null) => (blob ? (JSON.parse(blob) as { fields: Array<{ name: string }> }).fields.map((f) => f.name) : []);
  return { live: names(live), template: names(span) };
}

const SYNTHETIC = `<!doctype html><html><body>
<style>.custom-check input { opacity: 0; width: 0; height: 0; } .modal { display: none; }</style>
<div class="job"><form class="apply" method="post" action="/apply">
  <input type="hidden" name="job_id" value="77">
  <input type="text" name="full_name">
  <input type="text" name="name_check" value="prefilled">
  <input type="email" name="email_far" style="position:absolute;top:-5000px">
  <input type="text" name="tiny" style="width:0px">
  <input type="text" name="vis_hidden" style="visibility:hidden">
  <label class="custom-check"><input type="checkbox" name="terms" required>אני מאשר</label>
  <input type="file" name="cv" style="opacity:0">
  <button type="submit">שלח</button>
</form>
<div class="modal"><form class="later" method="post" action="/later"><textarea name="notes"></textarea><input type="text" name="phone"></form></div></div>
<script>document.querySelector('input[name="name_check"]').value = "";</script>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const expectSet = (got: string[], want: string[], who: string) => {
      const g = [...got].sort().join(",");
      const w = [...want].sort().join(",");
      assert(g === w, `${who}: fields ${g || "(none)"} — want ${w}`);
    };

    await serveFixture(page, "comblack-trap.html");
    const comblack = await bothPaths(page, "form.crmform");
    const comblackWant = ["courceid", "havercv", "firstname9", "phone9", "email9", "file", "accept_terms"];
    expectSet(comblack.live, comblackWant, "Comblack, live extractor");
    expectSet(comblack.template, comblackWant, "Comblack, capture template");

    await serveFixture(page, "prologic-trap.html");
    const prologic = await bothPaths(page, "form.JobPageSendCVForm");
    const prologicWant = ["file", "formtepy", "lidmakor", "PageURL", "cmsId", "cmsNameUrl", "formTs"];
    expectSet(prologic.live, prologicWant, "Prologic, live extractor");
    expectSet(prologic.template, prologicWant, "Prologic, capture template");

    await serve(page, "https://traps.test/jobs/1", SYNTHETIC);
    const synth = await bothPaths(page, "form.apply");
    const synthWant = ["job_id", "full_name", "terms", "cv"];
    expectSet(synth.live, synthWant, "synthetic, live extractor (emptied, far off-screen, zero width, own visibility hidden dropped; checkbox and file kept)");
    expectSet(synth.template, synthWant, "synthetic, capture template");
    const modal = await extractLiveFormData(page, { formSelector: "form.later" }, new Date());
    const modalNames = modal ? (JSON.parse(modal) as { fields: Array<{ name: string }> }).fields.map((f) => f.name) : [];
    expectSet(modalNames, ["notes", "phone"], "a form inside a closed modal keeps its fields (only a field's own style counts)");
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("formTraps: style-hidden, emptied and trap-named fields are dropped on both capture paths; real fields stay");
})().catch((e) => {
  console.error(`FAIL: formTraps test threw — ${(e as Error).message}`);
  process.exit(1);
});
