// Run: npx tsx worker/lib/formAcceptance.test.ts
//
// Report fixes 3, item 7 (the developer's 2026-10-21 report, item 3,
// LRN-FORM-21): Contact Form 7 refuses a submit whose acceptance box is
// unticked unless the box is marked optional, but the box carries no required
// or aria-required, so both captures stored required: false. A field inside
// .wpcf7-acceptance:not(.optional) is required, in the live extractor and in
// the shared template alike.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { extractLiveFormData } from "./formExtract";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// CF7's markup for two acceptance boxes, one optional, as CF7 5.x renders them.
const CF7_FORM = `<form class="wpcf7-form" method="post" action="/careers/#wpcf7-f7-o1">
  <input type="hidden" name="_wpcf7" value="7">
  <p><label>שם מלא<span class="wpcf7-form-control-wrap" data-name="your-name"><input type="text" name="your-name" class="wpcf7-text wpcf7-validates-as-required" aria-required="true"></span></label></p>
  <p><span class="wpcf7-form-control-wrap" data-name="acceptance-pripol"><span class="wpcf7-form-control wpcf7-acceptance"><span class="wpcf7-list-item"><label><input type="checkbox" name="acceptance-pripol" value="1" aria-invalid="false"><span class="wpcf7-list-item-label">קראתי ואני מסכים/ה למדיניות הפרטיות</span></label></span></span></span></p>
  <p><span class="wpcf7-form-control-wrap" data-name="acceptance-news"><span class="wpcf7-form-control wpcf7-acceptance optional"><span class="wpcf7-list-item"><label><input type="checkbox" name="acceptance-news" value="1"><span class="wpcf7-list-item-label">שלחו לי עדכונים</span></label></span></span></span></p>
  <p><span class="wpcf7-form-control-wrap" data-name="extras"><span class="wpcf7-form-control wpcf7-checkbox"><span class="wpcf7-list-item"><label><input type="checkbox" name="extras[]" value="a"><span>A</span></label></span></span></span></p>
  <input type="submit" value="שליחה">
</form>`;

async function serve(page: Page, url: string, body: string): Promise<void> {
  const origin = new URL(url).origin;
  await page.route(`${origin}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
  await page.goto(url);
}
const TEMPLATE = readFileSync(join(__dirname, "..", "..", "sites", "_shared", "form-capture-template.js"), "utf8").split("__ITEMSEL__").join(".job");
type Blob = { fields: Array<{ name: string; required: boolean }> };

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await serve(page, "https://cf7.test/careers/", `<!doctype html><html><body><div class="job">${CF7_FORM}</div></body></html>`);
    const live = JSON.parse((await extractLiveFormData(page, { formSelector: "form.wpcf7-form" }, new Date("2026-10-21T12:00:00Z"))) ?? "null") as Blob | null;
    await page.evaluate(TEMPLATE);
    const span = await page.evaluate(() => document.querySelector("[data-extracted-form]")?.textContent ?? null);
    const template = span ? (JSON.parse(span) as Blob) : null;
    for (const [who, blob] of [["live extractor", live], ["capture template", template]] as const) {
      const req = (n: string) => blob?.fields.find((f) => f.name === n)?.required;
      assert(req("acceptance-pripol") === true, `${who}: the acceptance box is required (got ${req("acceptance-pripol")})`);
      assert(req("acceptance-news") === false, `${who}: the one marked optional is not (got ${req("acceptance-news")})`);
      assert(req("extras[]") === false, `${who}: an ordinary CF7 checkbox is not (got ${req("extras[]")})`);
      assert(req("your-name") === true, `${who}: aria-required still counts`);
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("formAcceptance: a CF7 acceptance box not marked optional is required, on both capture paths");
})().catch((e) => {
  console.error(`FAIL: formAcceptance test threw — ${(e as Error).message}`);
  process.exit(1);
});
