// Run: npx tsx worker/lib/formPrefilled.test.ts
//
// A text-like field the page gave a value carries the job (developer's report
// 2026-10-18, item 2): Super-Pharm hides a text input by style and puts the
// job title in it; towersemi's fields arrive filled per job. The H4 rule
// dropped the first and stored the second with no value. Such a field is now
// kept with its value and marked prefilled; the style rule judges only a
// text-like field with no value, and one a script emptied on load is still a
// trap. Both capture paths: the live extractor and the shared capture template.
// H4's own cases stay in formTraps.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { extractLiveFormData } from "./formExtract";
import { normalizeFormFields, type RawFieldDescriptor } from "./formFields";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

type Field = { name: string; value?: string; prefilled?: boolean };

// --- the rule, pure ----------------------------------------------------------------------
{
  const d = (over: Partial<RawFieldDescriptor>): RawFieldDescriptor => ({ tag: "input", type: "text", name: "f", label: "f", required: false, ...over });
  const out = normalizeFormFields([
    d({ name: "job_title", styleHidden: true, value: "רוקח/ת אחראי/ת" }),
    d({ name: "req_no", value: "TS-1182" }),
    d({ name: "emailHidden", styleHidden: true, value: "" }),
    d({ name: "nameCopy", emptiedOnLoad: true, value: "" }),
    d({ name: "full_name", value: "" }),
  ]) as Field[];
  const by = new Map(out.map((f) => [f.name, f]));
  assert(by.get("job_title")?.value === "רוקח/ת אחראי/ת" && by.get("job_title")?.prefilled === true, "a style-hidden text field with a value is kept with it, prefilled");
  assert(by.get("req_no")?.value === "TS-1182" && by.get("req_no")?.prefilled === true, "a visible text field the page filled keeps its value, prefilled");
  assert(!by.has("emailHidden"), "a style-hidden text field with no value is still a trap");
  assert(!by.has("nameCopy"), "a field emptied on load is still a trap");
  assert(by.has("full_name") && by.get("full_name")!.value === undefined && by.get("full_name")!.prefilled === undefined, "an empty visible field stays, with no value and no mark");
}

/** A page served at `url` with `body`. Nothing leaves the machine. */
async function serve(page: Page, url: string, body: string): Promise<void> {
  const origin = new URL(url).origin;
  await page.unroute("**/*");
  await page.route(`${origin}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
  await page.goto(url);
}
const TEMPLATE = readFileSync(join(__dirname, "..", "..", "sites", "_shared", "form-capture-template.js"), "utf8").split("__ITEMSEL__").join(".job");

async function bothPaths(page: Page, formSelector: string): Promise<{ live: Field[]; template: Field[] }> {
  const live = await extractLiveFormData(page, { formSelector }, new Date("2026-10-18T12:00:00Z"));
  await page.evaluate(TEMPLATE);
  const span = await page.evaluate(() => document.querySelector("[data-extracted-form]")?.textContent ?? null);
  const fields = (blob: string | null) => (blob ? (JSON.parse(blob) as { fields: Field[] }).fields : []);
  return { live: fields(live), template: fields(span) };
}

// Super-Pharm's shape: the title in a style-hidden text input (one in the
// markup, one set by the page's script), a visible field filled per job, and
// H4's two traps beside them.
const PAGE = `<!doctype html><html><body>
<style>.jt { display: none; }</style>
<div class="job"><h2>רוקח/ת אחראי/ת</h2><form class="apply" method="post" action="/apply">
  <input type="text" class="jt" name="job_title" value="רוקח/ת אחראי/ת">
  <input type="text" name="position" style="opacity:0">
  <input type="text" name="req_no">
  <input type="text" name="full_name">
  <input type="email" name="email_trap" style="position:absolute;top:-5000px">
  <input type="text" name="name_check" value="prefilled">
  <button type="submit">שלח</button>
</form></div>
<script>
  document.querySelector('input[name="position"]').value = "SP-4410";
  document.querySelector('input[name="req_no"]').value = "TS-1182";
  document.querySelector('input[name="name_check"]').value = "";
</script>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await serve(page, "https://shop.test/jobs/4410", PAGE);
    const { live, template } = await bothPaths(page, "form.apply");
    for (const [who, fields] of [["live extractor", live], ["capture template", template]] as const) {
      const by = new Map(fields.map((f) => [f.name, f]));
      assert(by.get("job_title")?.value === "רוקח/ת אחראי/ת" && by.get("job_title")?.prefilled === true, `${who}: the style-hidden title is kept with its value, prefilled (got ${JSON.stringify(by.get("job_title"))})`);
      assert(by.get("position")?.value === "SP-4410" && by.get("position")?.prefilled === true, `${who}: a hidden-by-style field the script filled is kept with the script's value (got ${JSON.stringify(by.get("position"))})`);
      assert(by.get("req_no")?.value === "TS-1182" && by.get("req_no")?.prefilled === true, `${who}: a visible field filled per job keeps its value (got ${JSON.stringify(by.get("req_no"))})`);
      assert(by.has("full_name") && by.get("full_name")!.prefilled === undefined, `${who}: an empty field stays unmarked`);
      assert(!by.has("email_trap"), `${who}: the far off-screen empty field is still dropped`);
      assert(!by.has("name_check"), `${who}: the field emptied on load is still dropped`);
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("formPrefilled: a text field the page filled is kept with its value on both capture paths; H4's traps still dropped");
})().catch((e) => {
  console.error(`FAIL: formPrefilled test threw — ${(e as Error).message}`);
  process.exit(1);
});
