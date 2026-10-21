// Run: npx tsx scripts/lib/compactTemplate.test.ts
//
// Report fixes 3, item 16c (the developer's 2026-10-21 report, item 12,
// LRN-SETUP-33): the shared form template is 9,958 characters of a 16,000
// setup-script cap, and eladsoft's script reached the cap exactly after its
// comments were stripped by hand. sites/_shared/form-capture-template.compact.js
// is generated from the template (scripts/compact-form-template.mjs: comment
// lines and blank lines dropped, each line trimmed) and checked by
// `node scripts/compact-form-template.mjs --check`, which fails when the two
// differ. Here: the file is what the generator makes, much shorter, and the
// two capture the same form, run on one page.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..", "..");
const TEMPLATE = join(ROOT, "sites", "_shared", "form-capture-template.js");
const COMPACT = join(ROOT, "sites", "_shared", "form-capture-template.compact.js");
const GEN = join(ROOT, "scripts", "compact-form-template.mjs");

(async () => {
  assert(existsSync(COMPACT) && existsSync(GEN), "the compact copy and its generator exist");
  if (!existsSync(COMPACT) || !existsSync(GEN)) throw new Error("missing files");
  const full = readFileSync(TEMPLATE, "utf8");
  const compact = readFileSync(COMPACT, "utf8");
  assert(compact.length < full.length * 0.75, `the compact copy is much shorter (${compact.length} of ${full.length})`);
  assert(!/^\s*\/\//m.test(compact.split("\n").slice(1).join("\n")), "no comment line after its one header line");

  // The check passes on the repo as it is, and fails on a copy that drifted.
  let ok = true;
  try {
    execFileSync(process.execPath, [GEN, "--check"], { cwd: ROOT, stdio: "pipe" });
  } catch {
    ok = false;
  }
  assert(ok, "the check passes on the files as committed");
  const { compactTemplate } = await import("../compact-form-template.mjs" as string);
  assert(compactTemplate(full) === compact, "the committed copy is exactly what the generator makes");
  assert(compactTemplate("  // c\n\n  var a = 1;\n").includes("var a = 1;") && !compactTemplate("  // c\n\n  var a = 1;\n").includes("// c"), "comment and blank lines dropped, code kept");

  // The two capture the same form.
  const FORM = `<!doctype html><html><body><div class="job"><form class="wpcf7-form" method="post" action="/apply">
    <input type="hidden" name="_wpcf7" value="7">
    <label>שם<input type="text" name="your-name" aria-required="true"></label>
    <span class="wpcf7-form-control wpcf7-acceptance"><label><input type="checkbox" name="ok" value="1"> אישור</label></span>
    <select name="city"><option value="">בחר</option><option value="h">חיפה</option></select>
    <input type="file" name="cv" accept=".pdf">
    <span style="position:absolute;width:1px;height:1px;overflow:hidden"><input type="text" name="trap"></span>
  </form></div></body></html>`;
  const browser = await chromium.launch();
  try {
    const run = async (src: string) => {
      const page: Page = await browser.newPage();
      await page.route("https://compact.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FORM }));
      await page.goto("https://compact.test/jobs/1");
      await page.evaluate(src.split("__ITEMSEL__").join(".job"));
      const span = await page.evaluate(() => document.querySelector("[data-extracted-form]")?.textContent ?? null);
      await page.close();
      const blob = span ? JSON.parse(span) : null;
      if (blob) delete blob.capturedAt;
      return blob;
    };
    const a = await run(full);
    const b = await run(compact);
    assert(!!a && JSON.stringify(a) === JSON.stringify(b), `the compact copy captures exactly what the template does (got ${JSON.stringify(b)?.slice(0, 120)})`);
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("compactTemplate: the compact copy is the generator's, shorter, and captures what the template does");
})().catch((e) => {
  console.error(`FAIL: compactTemplate test threw — ${(e as Error).message}`);
  process.exit(1);
});
