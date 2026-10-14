// Run: npx tsx src/lib/registeredDomain.test.ts
//
// H6 (owner, 2026-10-14): the duplicate check matches the registered domain
// exactly. A search for tech.co.il returned naya-tech, horizontech, gtech and
// ness-tech through the contains match of ?urlSearch=, which stays for the
// dashboard; ?domain= is the exact one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registeredDomain, sameRegisteredDomain } from "./registeredDomain";
import { siteListQuerySchema } from "./validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// TECH, 2026-10-13.
const fleet = [
  "https://www.tech.co.il/jobs/",
  "https://careers.tech.co.il/",
  "https://www.naya-tech.co.il/careers",
  "https://horizontech.co.il/jobs",
  "https://gtech.co.il/%d7%9e%d7%a9%d7%a8%d7%95%d7%aa/",
  "https://www.ness-tech.co.il/careers/",
  "https://tech.co.il.example.com/",
];
const hits = fleet.filter((u) => sameRegisteredDomain(u, "tech.co.il"));
assert(JSON.stringify(hits) === JSON.stringify(["https://www.tech.co.il/jobs/", "https://careers.tech.co.il/"]), `only tech.co.il itself (got ${hits.join(", ")})`);
assert(sameRegisteredDomain("https://www.tech.co.il/x", "https://tech.co.il/") && sameRegisteredDomain("https://www.tech.co.il/x", "WWW.TECH.CO.IL"), "the search may be a URL, and any case");

assert(registeredDomain("careers.acme.co.il") === "acme.co.il", "a second-level .co.il keeps three labels");
assert(registeredDomain("https://jobs.weizmann.ac.il/x") === "weizmann.ac.il", ".ac.il too");
assert(registeredDomain("https://www.comeet.com/jobs/cglms/69.003") === "comeet.com", "a .com keeps two");
assert(registeredDomain("co.il") === "co.il" && registeredDomain("") === null && registeredDomain("not a host") === null, "edges");

// The wiring.
assert(siteListQuerySchema.safeParse({ domain: "tech.co.il" }).success, "?domain= is allowed in the strict list query");
assert(siteListQuerySchema.safeParse({ urlSearch: "tech" }).success, "and ?urlSearch= stays");
const svc = readFileSync(join(__dirname, "..", "services", "siteService.ts"), "utf8");
const list = svc.slice(svc.indexOf("export async function listSites"), svc.indexOf("export async function getStatusCounts"));
assert(/where\.siteUrl = \{ contains: urlSearch, mode: "insensitive" \}/.test(list), "listSites keeps the dashboard's contains match");
assert(/sameRegisteredDomain\(s\.siteUrl, domain\)/.test(list) && /where\.id = \{ in: /.test(list), "and filters ?domain= to the exact registered domain");
assert(/domain: q\.domain,/.test(readFileSync(join(__dirname, "..", "app", "api", "sites", "route.ts"), "utf8")), "the list route passes it");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("registeredDomain: the duplicate check matches the registered domain exactly");
