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

// Second half (owner, 2026-10-01): actionAttribute, pageUrl, submitMechanism
// and shapeHash on every blob — checked here on real fleet markup (kahane's
// Elementor form, anvei-zion's Contact Form 7, rad's Gravity Forms, each served
// at the URL it was read from) — and the template's blob stamped "script",
// with the same shapeHash the live extractor gives the same form.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { extractLiveFormData } from "./formExtract";
import { FORM_EXTRACTOR_VERSION } from "./formFields";
import { stampScriptFormBlob } from "./formShape";

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
  actionAttribute?: string;
  pageUrl?: string;
  submitMechanism?: string;
  submitEndpoint?: string;
  submitAction?: string;
  shapeHash?: string;
  method: string;
  enctype?: string;
  fields: Array<{ name: string; fieldType: string; value?: string; accept?: string; multiple?: boolean; options?: Array<{ value: string; label: string }> }>;
  capturedAt: string;
  captureSource: string;
  extractorVersion: number;
};

function checkBlob(b: Blob | null, who: string, source: string) {
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
  eq([b.captureSource, b.extractorVersion], [source, FORM_EXTRACTOR_VERSION], `${who}: stamped ${source}, version ${FORM_EXTRACTOR_VERSION}`);
  assert(!Number.isNaN(Date.parse(b.capturedAt)), `${who}: with an ISO capturedAt (${b.capturedAt})`);
  eq(b.actionAttribute, "https://medulla.test/wp-admin/admin-ajax.php", `${who}: actionAttribute, resolved absolute`);
  eq(b.pageUrl, "https://medulla.test/jobs/lab-technician/", `${who}: pageUrl, the page it was read from`);
}

/** A real form, served alone at the URL it was read from (its fixture's first line). */
async function serveFixture(page: Page, file: string): Promise<string> {
  const src = readFileSync(join(__dirname, "fixtures", "forms", file), "utf8");
  const url = /^<!-- (\S+) -->/.exec(src)?.[1] ?? "";
  const origin = new URL(url).origin;
  await page.unroute("**/*");
  await page.route(`${origin}/**`, (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body>${src}</body></html>` }),
  );
  await page.goto(url);
  return url;
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
    const liveBlob = live ? (JSON.parse(live) as Blob) : null;
    checkBlob(liveBlob, "live extractor", "live");
    eq(liveBlob?.capturedAt ?? null, "2026-10-01T09:30:00.000Z", "live extractor: capturedAt is the scrape's time");
    eq(
      [liveBlob?.submitMechanism, liveBlob?.submitEndpoint, liveBlob?.submitAction],
      ["ajax", "https://medulla.test/wp-admin/admin-ajax.php", "elementor_pro_forms_send_form"],
      "live extractor: an Elementor form is ajax to admin-ajax.php",
    );
    assert(/^[0-9a-f]{40}$/.test(liveBlob?.shapeHash ?? ""), "live extractor: a sha1 shapeHash");
    eq(await extractLiveFormData(page, { formSelector: "form#missing" }, new Date()), null, "a configured form that is not on the page: null, so the static blob is used");

    // --- the shared capture template ------------------------------------------------
    const template = readFileSync(join(__dirname, "..", "..", "sites", "_shared", "form-capture-template.js"), "utf8").split("__ITEMSEL__").join(".job");
    await page.evaluate(template);
    const span = await page.evaluate(() => document.querySelector("[data-extracted-form]")?.textContent ?? null);
    checkBlob(span ? (JSON.parse(span) as Blob) : null, "capture template", "script");
    // The template's blob reaches the row as an explicit applicationInfo, which the
    // normalizer stamps; the same form must then hash the same as the live read.
    const scripted = span ? (JSON.parse(stampScriptFormBlob(span, { pageUrl: "https://medulla.test/elsewhere/", at: new Date() })) as Blob) : null;
    eq(scripted?.pageUrl, "https://medulla.test/jobs/lab-technician/", "capture template: the stamp keeps the template's own pageUrl");
    eq(scripted?.submitMechanism, "ajax", "capture template: stamped ajax (Elementor's hidden fields)");
    eq(scripted?.shapeHash, liveBlob?.shapeHash, "capture template and live extractor: the same shapeHash for the same form");

    // --- real fleet markup, one per mechanism rule --------------------------------------
    const kahaneUrl = await serveFixture(page, "kahane-elementor.html");
    const kahane = JSON.parse((await extractLiveFormData(page, { formSelector: "form.elementor-form" }, new Date())) ?? "null") as Blob | null;
    eq(kahane?.actionAttribute, "", "kahane: the form has no action attribute, so actionAttribute is empty");
    eq(kahane?.actionUrl, kahaneUrl, "kahane: actionUrl keeps today's meaning (the page)");
    eq(kahane?.pageUrl, kahaneUrl, "kahane: pageUrl");
    eq(
      [kahane?.submitMechanism, kahane?.submitEndpoint, kahane?.submitAction],
      ["ajax", "https://www.kahane.co.il/wp-admin/admin-ajax.php", "elementor_pro_forms_send_form"],
      "kahane (Elementor Pro): ajax to admin-ajax.php, action elementor_pro_forms_send_form",
    );

    const anveiUrl = await serveFixture(page, "anvei-zion-cf7.html");
    const anvei = JSON.parse((await extractLiveFormData(page, { formSelector: "form.wpcf7-form" }, new Date())) ?? "null") as Blob | null;
    eq(anvei?.actionAttribute, `${anveiUrl}#wpcf7-f10-o1`, "anvei-zion: actionAttribute is the form's own action, resolved");
    eq(
      [anvei?.submitMechanism, anvei?.submitEndpoint, anvei?.submitAction],
      ["ajax", "https://www.anvei-zion.com/wp-json/contact-form-7/v1/contact-forms/10/feedback", undefined],
      "anvei-zion (Contact Form 7): ajax to its feedback endpoint, form 10",
    );
    eq(anvei?.enctype, "multipart/form-data", "anvei-zion: enctype");

    const radUrl = await serveFixture(page, "rad-gravity.html");
    const rad = JSON.parse((await extractLiveFormData(page, { formSelector: "#gform_7" }, new Date())) ?? "null") as Blob | null;
    eq(rad?.actionAttribute, `${radUrl}#gf_7`, "rad: actionAttribute");
    eq(
      [rad?.submitMechanism, rad?.submitEndpoint],
      ["native_form", undefined],
      "rad (Gravity Forms, iframe submission): a real form post to its action",
    );
    eq(rad?.pageUrl, radUrl, "rad: pageUrl");

    // --- lighting.co.il (owner, 2026-10-08; the developer's report of 2026-10-07) ----------
    // The Magento idus_forms container, as served (no script ran): a div with
    // action="/forms/index/index/", five fields required the Magento way
    // (data-validate="{required:true}"), and two textareas sharing one id with
    // two labels — the site's own markup error.
    await serveFixture(page, "lighting-magento.html");
    const lighting = JSON.parse((await extractLiveFormData(page, { formSelector: "div.idus_forms_jobs_form" }, new Date())) ?? "null") as {
      submitMechanism?: string;
      submitEndpoint?: string;
      submitAction?: string;
      fields: Array<{ name: string; label: string; required: boolean; fieldType: string }>;
    } | null;
    eq(
      [lighting?.submitMechanism, lighting?.submitEndpoint, lighting?.submitAction],
      ["ajax", "https://www.lighting.co.il/forms/index/index/", undefined],
      "lighting: ajax to its own action (/forms/index/index/), never admin-ajax or Elementor's action",
    );
    eq(
      (lighting?.fields ?? []).filter((x) => x.required).map((x) => x.name).sort(),
      ["address", "email", "first_name", "last_name", "tel"],
      "lighting: the five data-validate {required:true} fields are required",
    );
    eq(
      (lighting?.fields ?? []).filter((x) => x.fieldType === "textarea").map((x) => x.label),
      ["שם המשרה", "הערות"],
      "lighting: the two textareas sharing an id keep their own labels (placeholder fallback)",
    );
    // aria-required="true" (the page's own script adds it live) counts too.
    await page.evaluate(() => {
      const el = document.querySelector('[name="first_name"]');
      el?.removeAttribute("data-validate");
      el?.setAttribute("aria-required", "true");
    });
    const aria = JSON.parse((await extractLiveFormData(page, { formSelector: "div.idus_forms_jobs_form" }, new Date())) ?? "null") as
      | { fields: Array<{ name: string; required: boolean }> }
      | null;
    eq(aria?.fields.find((x) => x.name === "first_name")?.required, true, "lighting: aria-required=\"true\" alone is required");

    // naamat.org.il: the WordPress jobs plugin, hidden action=jobslisting_apply_now.
    await serveFixture(page, "naamat-jobs-modal.html");
    const naamat = JSON.parse((await extractLiveFormData(page, { formSelector: "#jobs-modal-form" }, new Date())) ?? "null") as Blob | null;
    eq(
      [naamat?.submitMechanism, naamat?.submitEndpoint, naamat?.submitAction],
      ["ajax", "https://naamat.org.il/wp-admin/admin-ajax.php", "jobslisting_apply_now"],
      "naamat: ajax to admin-ajax.php with its own hidden action, not Elementor's",
    );
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
  // Since step 2b the replay check runs inside runValueChecks, over the rows' _formData.
  const checksSrc = readFileSync(join(__dirname, "valueChecks.ts"), "utf8");
  assert(/formBlobs: rows\.map\(/.test(scrape) && /\["_formData"\]/.test(scrape), "scrape.ts hands the run's forms to the value checks");
  assert(/applyReplayTokenFinding\(input\.formBlobs/.test(checksSrc), "the replay check runs over the run's forms");
  assert(/completeFormBlob\(cfg\.staticBlob, \{ pageUrl: page\.url\(\), actionAttribute: "" \}\)/.test(scrape), "a static blob gains pageUrl, an empty actionAttribute, mechanism and hash where it is attached");
  assert(/normalizeJobRecord\(rawFields, \{ at: /.test(scrape), "the normalizer gets the scrape's time for the script stamp");
  assert(/formClass/.test(evaluated) && /getAttribute\("action"\)/.test(evaluated), "the page code reports the form's class and raw action attribute");

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("formExtract: live extractor and capture template agree — hidden values, radio groups, file accept/multiple, enctype, stamps");
})().catch((e) => {
  console.error(`FAIL: formExtract test threw — ${(e as Error).message}`);
  process.exit(1);
});
