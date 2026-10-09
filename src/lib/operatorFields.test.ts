// Run: npx tsx src/lib/operatorFields.test.ts
//
// A hand-set company field survives a recapture (owner, 2026-10-09).
// Site.companyOperatorFields lists the profile columns the operator set by hand
// in the dashboard's edit dialog: about, address, homepage (the HQ city keeps
// its own provenance column and is never listed). The dashboard routes add a
// name on a non-null write and remove it on a clear; the capture omits every
// listed key from the payload it saves (--replace-field lets one through).
// Plus the wiring in the routes, the service, the capture and the panel.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATOR_FIELD_COLUMNS, keepOperatorFields, nextOperatorFields, parseReplaceFields } from "./operatorFields";

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

eq([...OPERATOR_FIELD_COLUMNS], ["companyAbout", "companyHqAddress", "companyHomepageUrl"], "the three columns, and not the city");

// --- the route side: names added and removed -----------------------------------------
eq(nextOperatorFields([], { companyAbout: "Hand-written about." }), ["companyAbout"], "a non-null write adds the name");
eq(nextOperatorFields(["companyAbout"], { companyHqAddress: "Derech Ha'atzmaut 1" }), ["companyAbout", "companyHqAddress"], "another field is added beside it");
eq(nextOperatorFields(["companyAbout", "companyHqAddress"], { companyAbout: null }), ["companyHqAddress"], "a clear to null removes the name");
eq(nextOperatorFields(["companyAbout"], { companyAbout: "   " }), [], "a blank write is a clear (the service stores it as null)");
eq(nextOperatorFields(["companyAbout"], { companyAbout: "again" }), ["companyAbout"], "writing a listed field again keeps one entry");
eq(nextOperatorFields(["companyAbout"], {}), ["companyAbout"], "an absent key changes nothing");
eq(nextOperatorFields([], { companyHqCity: "Haifa", companyProfileStatus: "COMPLETE" }), [], "the city and other keys are never listed");
eq(nextOperatorFields([], { companyHomepageUrl: "https://www.example.co.il" }), ["companyHomepageUrl"], "the homepage route's write is listed");
eq(nextOperatorFields(["companyHqAddress", "companyAbout"], { companyHomepageUrl: "https://x.test" }), ["companyAbout", "companyHqAddress", "companyHomepageUrl"], "the list is kept in column order");

// --- the capture side: listed fields are kept -----------------------------------------
const PAYLOAD = {
  companyHomepageUrl: "https://captured.test",
  companyAbout: "Captured about.",
  companyHqAddress: null,
  companyHqCity: "Haifa",
  companyProfileStatus: "COMPLETE",
};
{
  const r = keepOperatorFields(PAYLOAD, ["companyAbout", "companyHqAddress"], []);
  assert(!("companyAbout" in r.payload) && !("companyHqAddress" in r.payload), "a listed field's key is not in the payload at all (a null would clear it)");
  eq(r.payload.companyHomepageUrl, "https://captured.test", "an unlisted field is written");
  eq([r.payload.companyHqCity, r.payload.companyProfileStatus], ["Haifa", "COMPLETE"], "the other keys pass unchanged");
  eq(r.kept, ["companyAbout", "companyHqAddress"], "and the kept fields are named");
}
{
  const r = keepOperatorFields(PAYLOAD, ["companyAbout", "companyHqAddress"], ["companyAbout"]);
  eq(r.payload.companyAbout, "Captured about.", "--replace-field companyAbout lets that field through");
  assert(!("companyHqAddress" in r.payload), "and only that field");
  eq(r.kept, ["companyHqAddress"], "the other stays kept");
}
eq(keepOperatorFields(PAYLOAD, [], []).payload, PAYLOAD, "nothing listed: the payload is unchanged");
eq(keepOperatorFields(PAYLOAD, ["companyHqCity"], []).payload, PAYLOAD, "a name that is not an operator column is ignored");

eq(parseReplaceFields(["--site", "x", "--replace-field", "companyAbout", "--force", "--replace-field", "companyHqAddress"]), ["companyAbout", "companyHqAddress"], "--replace-field is repeatable");
eq(parseReplaceFields(["--site", "x"]), [], "absent: none");
{
  let threw = "";
  try {
    parseReplaceFields(["--replace-field", "companyHqCity"]);
  } catch (e) {
    threw = (e as Error).message;
  }
  assert(/companyAbout.*companyHqAddress.*companyHomepageUrl/.test(threw), `an unknown name is refused, naming the three (${threw})`);
}

// --- the wiring ---------------------------------------------------------------------
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
{
  const schema = read("prisma/schema.prisma");
  const site = schema.slice(schema.indexOf("model Site {"), schema.indexOf("\n}\n", schema.indexOf("model Site {")));
  assert(/companyOperatorFields\s+String\[\]\s+@default\(\[\]\)/.test(site), "Site.companyOperatorFields String[] @default([])");

  const svc = read("src/services/siteService.ts");
  const sel = svc.slice(svc.indexOf("export const COMPANY_PROFILE_SELECT"), svc.indexOf("} as const;", svc.indexOf("export const COMPANY_PROFILE_SELECT")));
  assert(/companyOperatorFields: true/.test(sel), "the company-profile GET returns the list");
  assert(/export async function recordOperatorFields\(/.test(svc) && /nextOperatorFields\(/.test(svc), "the service records the list with nextOperatorFields");

  for (const [route, call] of [
    ["src/app/api/sites/[id]/company-profile/route.ts", "recordOperatorFields(id, parsed.data)"],
    ["src/app/api/sites/[id]/company-homepage/route.ts", "recordOperatorFields(id, { companyHomepageUrl: site.companyHomepageUrl })"],
  ] as const) {
    const src = read(route);
    const at = src.indexOf(`if (isDashboardRequest(request)) await ${call}`);
    assert(at > 0, `${route}: records the list on the dashboard's write only`);
  }
  assert(!read("src/app/api/sites/[id]/company-hq-city/route.ts").includes("recordOperatorFields("), "the HQ-city route keeps its own provenance and lists nothing");

  const cap = read("scripts/company-profile.ts");
  const wp = cap.slice(cap.indexOf("async function writeProfile("), cap.indexOf("\n}\n", cap.indexOf("async function writeProfile(")));
  assert(/keepOperatorFields\(/.test(wp), "the capture's write applies keepOperatorFields");
  assert(/"GET",\s*`\/api\/sites\/\$\{siteId\}\/company-profile`/.test(wp), "after reading the stored list fresh, whatever resolved the site");
  assert(/parseReplaceFields\(process\.argv/.test(cap), "--replace-field is parsed from the command line");
  assert(/kept the hand-set/.test(cap), "and the kept fields are printed");

  const panel = read("src/components/sites/SiteCompanyProfileDialog.tsx");
  assert(/set by hand/.test(panel) && /companyOperatorFields/.test(panel), "the panel marks a kept field 'set by hand'");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("operatorFields: all assertions passed");
