// Run: npx tsx src/lib/companyHomepagePath.test.ts
//
// A company homepage sent with a path keeps it (developer's report 2026-10-18,
// item 3): the route stored the origin, so a subsidiary whose homepage is a
// path on its group's host got the group's homepage (Elipse;
// careers.deloitte.co.il). A language prefix alone still collapses to the
// origin (diplomat's /he/). The capture compares the stored value with its own
// derivation, so keeping the path is no change at capture.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capturedHomepage, companyHomepageValue } from "./companyHomepage";
import { fieldsForWrite } from "./autoFix";

let failures = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL: ${msg}\n  got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
    failures++;
  }
}

// The route's value.
eq(companyHomepageValue("https://www.group.co.il/elipse/"), "https://www.group.co.il/elipse", "a subsidiary URL with a path keeps it");
eq(companyHomepageValue("https://www2.deloitte.com/il/he.html"), "https://www2.deloitte.com/il/he.html", "a deeper path is kept whole");
eq(companyHomepageValue(" https://www.group.co.il/elipse/?utm=x#top "), "https://www.group.co.il/elipse", "query, fragment, trailing slash and spaces go");
eq(companyHomepageValue("https://www.diplomat.co.il/he/"), "https://www.diplomat.co.il", "diplomat: /he/ alone collapses to the origin");
eq(companyHomepageValue("https://www.x.co.il/en"), "https://www.x.co.il", "/en alone too");
eq(companyHomepageValue("https://www.x.co.il/he-il/"), "https://www.x.co.il", "/he-il alone too");
eq(companyHomepageValue("https://www.foxgroup.co.il/"), "https://www.foxgroup.co.il", "a root URL is the origin");
eq(companyHomepageValue(null), null, "null still clears");

// The round trip: stored with its path, the capture writes the same value.
{
  const stored = companyHomepageValue("https://www.group.co.il/elipse/");
  const written = capturedHomepage(stored, "https://www.group.co.il/elipse/");
  eq(written, "https://www.group.co.il/elipse", "the capture keeps the stored path");
  eq(fieldsForWrite({ kind: "company", before: { companyHomepageUrl: stored }, after: { companyHomepageUrl: written } }), [], "and opens no COMPANY item");
  eq(capturedHomepage("https://www.diplomat.co.il", "https://www.diplomat.co.il/he/"), "https://www.diplomat.co.il", "diplomat's stored origin is kept when the page lands on /he/");
  eq(capturedHomepage(null, "https://www.acme.co.il/he/home"), "https://www.acme.co.il", "with nothing stored, the harvested origin, as before");
  eq(capturedHomepage("https://www.old-host.co.il/sub", "https://www.new-host.co.il/"), "https://www.new-host.co.il", "a page that moved to another host gives its own origin");
}

// The wiring: the route stores companyHomepageValue; the capture writes capturedHomepage.
{
  const route = readFileSync(join(__dirname, "..", "app", "api", "sites", "[id]", "company-homepage", "route.ts"), "utf8");
  eq(/saveCompanyHomepage\(id, companyHomepageValue\(parsed\.data\.companyHomepageUrl\)\)/.test(route), true, "the route stores companyHomepageValue(...)");
  const capture = readFileSync(join(__dirname, "..", "..", "scripts", "company-profile.ts"), "utf8");
  eq(/result\.fields\.companyHomepageUrl = capturedHomepage\(supplied, homepage\.url\);/.test(capture), true, "the capture writes capturedHomepage(supplied, homepage.url)");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("companyHomepagePath: a homepage path is kept unless it is a language prefix alone; the capture keeps it");
