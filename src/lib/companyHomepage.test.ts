// Run: npx tsx src/lib/companyHomepage.test.ts
//
// (m), owner 2026-10-06: the operator homepage route stores the ORIGIN of the
// URL it is given. The capture stores the homepage's origin too
// (scripts/company-profile.ts originOf), so its normalisation never reads as a
// change to a held company field. diplomat's operator homepage
// https://www.diplomat.co.il/he/ became https://www.diplomat.co.il at capture
// and opened a COMPANY fix item that was not a fix.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homepageOrigin } from "./companyHomepage";
import { fieldsForWrite } from "./autoFix";

let failures = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL: ${msg}\n  got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
    failures++;
  }
}

eq(homepageOrigin("https://www.diplomat.co.il/he/"), "https://www.diplomat.co.il", "diplomat: /he/ is stored as the origin");
eq(homepageOrigin("https://www.foxgroup.co.il/"), "https://www.foxgroup.co.il", "a trailing slash goes too");
eq(homepageOrigin("  https://www.meyeden.co.il/he?x=1#top "), "https://www.meyeden.co.il", "path, query, fragment and spaces go");
eq(homepageOrigin(null), null, "null still clears");

// The point of it: the capture's later write is no change at all.
const capture = "https://www.diplomat.co.il"; // originOf() of the harvested homepage
eq(
  fieldsForWrite({ kind: "company", before: { companyHomepageUrl: homepageOrigin("https://www.diplomat.co.il/he/") }, after: { companyHomepageUrl: capture } }),
  [],
  "stored as the origin, the capture's homepage opens no COMPANY item",
);
eq(
  fieldsForWrite({ kind: "company", before: { companyHomepageUrl: "https://www.diplomat.co.il/he/" }, after: { companyHomepageUrl: capture } }),
  ["COMPANY"],
  "stored as typed, it did",
);

const route = readFileSync(join(__dirname, "..", "app", "api", "sites", "[id]", "company-homepage", "route.ts"), "utf8");
eq(/saveCompanyHomepage\(id, homepageOrigin\(parsed\.data\.companyHomepageUrl\)\)/.test(route), true, "the route stores homepageOrigin(...)");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("companyHomepage: the operator route stores the origin, as the capture does");
