// Run: npx tsx worker/lib/detailUnavailable.test.ts
//
// A detail page may declare itself unavailable (owner, 2026-10-07). Civi serves
// a job's promo page only after its card is first clicked; before that the URL
// answers HTTP 200 with a "דף לא קיים" (page does not exist) shell. The worker
// counted that as an ok visit, the title came from the listing card, and the
// row was written with an empty description.
//
// A setupScript that recognises such a shell injects an element matching
// DETAIL_UNAVAILABLE_SELECTOR. The worker then records the visit as failed
// (status "unavailable"): the row carries no fields, so it is not written, it
// is counted under dead_detail_pages, and it is never stamped for a carry.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as detailPlan from "./detailPlan";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const SELECTOR = (detailPlan as Record<string, unknown>).DETAIL_UNAVAILABLE_SELECTOR;
const STATUS = (detailPlan as Record<string, unknown>).DETAIL_UNAVAILABLE_STATUS;
assert(SELECTOR === "[data-haide-detail-unavailable]", `the marker is [data-haide-detail-unavailable] (got ${String(SELECTOR)})`);
assert(STATUS === "unavailable", `the visit status is "unavailable" (got ${String(STATUS)})`);

// Never stamped, so never carried on a later night (stampFetched skips a failed visit).
const stamped = detailPlan.stampFetched(
  { _detailUrl: "https://x.test/1", _detailNavStatus: "unavailable" },
  { title: "t" },
  null,
  new Date("2026-10-07T00:00:00Z"),
);
assert(!("_cardFingerprint" in stamped), "an unavailable visit is not stamped for a carry");

// --- scrape.ts wiring -------------------------------------------------------------
const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
const loop = src.slice(src.indexOf("// Visit each detail page sequentially"), src.indexOf("function countDeadDetailPages"));
const setup = loop.indexOf("await runSetupScript(page, setupScript);");
const check = loop.indexOf("page.$(DETAIL_UNAVAILABLE_SELECTOR)");
const fields = loop.indexOf("for (const [fieldName, mapping] of Object.entries(fieldsToRunOnDetail))");
assert(setup >= 0 && check > setup, "the marker is checked after the detail page's setupScript runs");
assert(check >= 0 && fields > check, "and before any field is extracted");
const branch = check >= 0 ? loop.slice(check, loop.indexOf("continue;", check) + 9) : "";
assert(/_detailNavStatus:\s*DETAIL_UNAVAILABLE_STATUS/.test(branch), "the visit is recorded with status unavailable");
assert(!/\.\.\.\(listingFieldsByUrl/.test(branch) && !/title/.test(branch.replace(/\/\/.*$/gm, "")), "with no listing fields, so the row has no title and is not written");
assert(/continue;$/.test(branch), "and the visit ends there");

const dead = src.slice(src.indexOf("function countDeadDetailPages"), src.indexOf("function buildScrapeWarnings"));
assert(/DETAIL_UNAVAILABLE_STATUS/.test(dead), "countDeadDetailPages counts an unavailable visit");
assert(/unavailable/.test(src.slice(src.indexOf("function buildScrapeWarnings"), src.indexOf("function buildScrapeWarnings") + 2000)), "and the dead_detail_pages warning says so");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("detailUnavailable: a detail page that declares itself unavailable is a failed visit");
