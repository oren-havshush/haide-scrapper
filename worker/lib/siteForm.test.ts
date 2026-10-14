// Run: npx tsx worker/lib/siteForm.test.ts
//
// H2 (owner, 2026-10-14): the listing-only branch's site-level form never
// overwrites a per-job form the setup script built. Only records without
// _formData get the site's form (barakl and experis, 2026-10-13).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attachSiteForm, needsSiteForm } from "./siteForm";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const OWN = JSON.stringify({ actionUrl: "https://x.example/apply", fields: [{ name: "job_id", value: "4711" }] });
const SITE = JSON.stringify({ actionUrl: "https://x.example/contact", fields: [{ name: "name" }] });

// The two-record fixture: one job with its own form, one without.
{
  const records: Array<Record<string, string>> = [
    { title: "job with its own form", _formData: OWN },
    { title: "job without one" },
  ];
  assert(needsSiteForm(records), "one record has no form: the site's form is captured");
  const n = attachSiteForm(records, SITE);
  assert(records[0]._formData === OWN, "the per-job form is kept, not overwritten");
  assert(records[1]._formData === SITE, "the record without one gets the site's form");
  assert(n === 1, `one record got it (got ${n})`);
}
{
  const all: Array<Record<string, string>> = [{ _formData: OWN }, { _formData: OWN }];
  assert(!needsSiteForm(all), "every record has its own form: nothing to capture");
  assert(attachSiteForm(all, SITE) === 0 && all.every((r) => r._formData === OWN), "and nothing is written");
  const none = [{ title: "a" }, { title: "b" }] as Array<Record<string, string>>;
  assert(attachSiteForm(none, SITE) === 2 && none.every((r) => r._formData === SITE), "no per-job forms: every record gets the site's, as before");
  assert(!needsSiteForm([]), "no records: nothing to capture");
}

// The wiring: the listing-only branch uses the guard.
{
  const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const start = src.indexOf("listingStats.listingItemsSeen = await page.evaluate(");
  const end = src.indexOf("return { items: rawFieldsList, seen: listingStats.listingItemsSeen };", start);
  const branch = src.slice(start, end);
  assert(start > 0 && end > start, "the listing-only branch's form capture was found");
  assert(/formCaptureConfig && needsSiteForm\(rawFieldsList\)/.test(branch), "it captures only when some record lacks a form");
  assert(/attachSiteForm\(rawFieldsList, formData\)/.test(branch), "and attaches through attachSiteForm");
  assert(!/raw\["_formData"\] = formData/.test(branch), "with no bare overwrite left");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("siteForm: a per-job form is never overwritten by the site's form");
