// Run: npx tsx worker/lib/formExtract.test.ts
//
// Step 2a behaviour test (owner, 2026-10-01): one local Elementor-style page
// (the medulla shape) run through BOTH capture paths in a real browser —
//   - the worker's per-job live extractor (worker/lib/formExtract.ts), and
//   - the shared capture template (sites/_shared/form-capture-template.js)
// — and both must return every hidden input with its value (a honeypot-named
// one included), the radio group as one field with options, the file input's
// accept and multiple, the form's enctype, and the three stamps.
// Plus the wiring: the evaluated body declares no named functions (tsx's
// keepNames would inject __name calls the page cannot run), and scrape.ts
// uses the extractor, the static stamp and the replay check.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { extractLiveFormData } from "./formExtract";

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

const FIXTURE = `<!doctype html><html lang="he"><body>
<div class="job">
  <h2>Lab Technician</h2>
  <form class="elementor-form" method="post" action="/wp-admin/admin-ajax.php" enctype="multipart/form-data">
    <input type="hidden" name="post_id" value="18642">
    <input type="hidden" name="form_id" value="723b7d">
    <input type="hidden" name="queried_id" value="20417">
    <input type="hidden" name="form_fields[Job]" value="Lab Technician">
    <input type="hidden" name="_wpnonce" value="a1b2c3d4e5">
    <input type="hidden" name="hp_email_confirm" class="hp-field" value="">
    <label for="n">שם מלא</label><input id="n" type="text" name="form_fields[name]" required>
    <input type="text" name="hp_website" style="position:absolute;left:-99999px">
    <fieldset><legend>משמרת</legend>
      <label><input type="radio" name="form_fields[shift]" value="morning" required>בוקר</label>
      <label><input type="radio" name="form_fields[shift]" value="evening">ערב</label>
    </fieldset>
    <label for="cv">קורות חיים</label><input id="cv" type="file" name="form_fields[cv]" accept=".pdf,.doc,.docx" multiple required>
    <select name="form_fields[city]"><option value="">בחר</option><option value="haifa">חיפה</option></select>
    <button type="submit">שלח</button>
  </form>
</div>
<script>document.querySelector('input[name="_wpnonce"]').value = "set-by-script-9f8e";</script>
</body></html>`;

type Blob = {
  actionUrl: string;
  method: string;
  enctype?: string;
  fields: Array<{ name: string; fieldType: string; value?: string; accept?: string; multiple?: boolean; options?: Array<{ value: string; label: string }> }>;
  capturedAt: string;
  captureSource: string;
  extractorVersion: number;
};

function checkBlob(b: Blob | null, who: string) {
  assert(!!b, `${who}: returned a form`);
  if (!b) return;
  const by = new Map(b.fields.map((f) => [f.name, f]));
  for (const [name, value] of [["post_id", "18642"], ["form_id", "723b7d"], ["queried_id", "20417"], ["form_fields[Job]", "Lab Technician"]]) {
    eq(by.get(name)?.value, value, `${who}: hidden ${name} with its value`);
  }
  eq(by.get("_wpnonce")?.value, "set-by-script-9f8e", `${who}: the hidden value as the page holds it now, not the markup's`);
  assert(by.has("hp_email_confirm"), `${who}: a honeypot-named hidden input is kept`);
  assert(!by.has("hp_website"), `${who}: a visible off-screen honeypot is dropped`);
  const shift = b.fields.filter((f) => f.name === "form_fields[shift]");
  eq(shift.length, 1, `${who}: the radio group is one field`);
  eq(shift[0]?.options, [{ value: "morning", label: "בוקר" }, { value: "evening", label: "ערב" }], `${who}: with its options`);
  eq([by.get("form_fields[cv]")?.accept, by.get("form_fields[cv]")?.multiple], [".pdf,.doc,.docx", true], `${who}: file accept and multiple`);
  eq(by.get("form_fields[city]")?.options?.length, 2, `${who}: select options`);
  assert(!b.fields.some((f) => f.fieldType === "submit"), `${who}: no submit`);
  eq(b.enctype, "multipart/form-data", `${who}: the form's enctype`);
  eq(b.method, "POST", `${who}: the method`);
  assert(/\/wp-admin\/admin-ajax\.php$/.test(b.actionUrl), `${who}: the action (${b.actionUrl})`);
  eq([b.captureSource, b.extractorVersion], ["live", 2], `${who}: stamped live, version 2`);
  assert(!Number.isNaN(Date.parse(b.capturedAt)), `${who}: with an ISO capturedAt (${b.capturedAt})`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Served at a real-looking job URL, so the relative action resolves as it
    // does on a live site. Nothing leaves the machine.
    await page.route("https://medulla.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE }));
    await page.goto("https://medulla.test/jobs/lab-technician/");

    // --- the worker's live extractor ----------------------------------------------
    const live = await extractLiveFormData(page, { formSelector: "form.elementor-form" }, new Date("2026-10-01T09:30:00Z"));
    checkBlob(live ? (JSON.parse(live) as Blob) : null, "live extractor");
    eq(live ? JSON.parse(live).capturedAt : null, "2026-10-01T09:30:00.000Z", "live extractor: capturedAt is the scrape's time");
    eq(await extractLiveFormData(page, { formSelector: "form#missing" }, new Date()), null, "a configured form that is not on the page: null, so the static blob is used");

    // --- the shared capture template ------------------------------------------------
    const template = readFileSync(join(__dirname, "..", "..", "sites", "_shared", "form-capture-template.js"), "utf8").split("__ITEMSEL__").join(".job");
    await page.evaluate(template);
    const span = await page.evaluate(() => document.querySelector("[data-extracted-form]")?.textContent ?? null);
    checkBlob(span ? (JSON.parse(span) as Blob) : null, "capture template");
  } finally {
    await browser.close();
  }

  // --- wiring ----------------------------------------------------------------------------
  const extractSrc = readFileSync(join(__dirname, "formExtract.ts"), "utf8");
  const evaluated = extractSrc.slice(extractSrc.indexOf("page.evaluate("), extractSrc.indexOf("}, cfg"));
  assert(evaluated.length > 200, "the evaluated body was found");
  assert(!/\bfunction\s+[A-Za-z_$]/.test(evaluated), "the evaluated body declares no named function (keepNames would inject __name)");
  assert(/\.value\b/.test(evaluated), "it reads each input's live value");
  const scrape = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  assert(/extractLiveFormData\(page, formCaptureConfig, new Date\(\)\)/.test(scrape), "scrape.ts extracts live forms through formExtract");
  assert(/staticFormBlob\(formCapture, /.test(scrape), "the static blob is built stamped");
  assert(/_formData: stamp|stampFormData\(/.test(scrape), "buildJobRows stamps any _formData that came unstamped");
  assert(/applyReplayTokenFinding\(/.test(scrape), "the replay check runs over the run's forms");

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("formExtract: live extractor and capture template agree — hidden values, radio groups, file accept/multiple, enctype, stamps");
})().catch((e) => {
  console.error(`FAIL: formExtract test threw — ${(e as Error).message}`);
  process.exit(1);
});
