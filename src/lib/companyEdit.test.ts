// Run: npx tsx src/lib/companyEdit.test.ts
//
// (o), owner 2026-10-06: company fields editable in the dashboard, as a form
// over the existing routes. Two pieces are new and pure, and are pinned here:
//   - resolveHqCity, the HQ-city gate saveCompanyHqCity applies, lifted out so
//     its refusals can be tested without a database;
//   - companyEditPlan, which turns the form into requests: only the keys the
//     operator changed, and a null only from an explicit clear control, never
//     from an empty textbox.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ValidationError } from "./errors";
import { isCanonicalLocation, isRegionLocation, resolveHqCity } from "./locations";
import { companyEditPlan, hqCityOptions, isOfferedHqCity, type CompanyEditBefore, type CompanyEditDraft } from "./companyEdit";

let failures = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL: ${msg}\n  got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
    failures++;
  }
}
function refused(raw: string, pattern: RegExp, msg: string) {
  try {
    const got = resolveHqCity(raw);
    console.error(`FAIL: ${msg}\n  accepted as ${JSON.stringify(got)}`);
    failures++;
  } catch (e) {
    if (!(e instanceof ValidationError) || !pattern.test((e as Error).message)) {
      console.error(`FAIL: ${msg}\n  threw ${(e as Error).name}: ${(e as Error).message}`);
      failures++;
    }
  }
}

// --- resolveHqCity: the city.csv gate ------------------------------------------
eq(resolveHqCity("פתח תקווה"), "פתח תקווה", "a city.csv entry is stored as is");
eq(resolveHqCity("  פתח תקווה  "), "פתח תקווה", "surrounding spaces go");
eq(resolveHqCity("ת\"א"), "תל אביב-יפו", "an abbreviation is stored in its canonical spelling");
eq(resolveHqCity(null), null, "null clears");
eq(resolveHqCity("   "), null, "a blank value clears, as before");
refused("Springfield", /^Not a known city: "Springfield"\. .*CSV files\/city\.csv/, "a name not in city.csv is refused with a clear error");
refused("פתח", /^Not a known city: "פתח"/, "part of a name is refused");
refused("חיפה, עכו", /^Not a known city/, "two cities are refused: an HQ is one place");
refused("אזור מרכז", /is a region, not a place/, "a region is refused");

// Exact only (owner, 2026-10-07): a city.csv entry, or a CITY_ABBREVIATIONS
// key stored as its full entry. No alias, fuzzy or English matching: the loose
// gate stored "תקווה" as תקומה, a different town.
refused("תקווה", /^Not a known city: "תקווה"\. .*pick the city from the list/, "a near miss is refused (the loose gate stored תקומה)");
refused("Petah Tikva", /^Not a known city: "Petah Tikva"/, "an English name is refused");
refused("פתח תקוה רבתי", /^Not a known city/, "a longer phrase containing a city is refused");
refused("תל אביב", /^Not a known city/, "an alias that is not an abbreviation is refused");
refused("בת\"א", /^Not a known city/, "an abbreviation with a leading ב is refused");
eq(resolveHqCity("פ\"ת"), "פתח תקווה", "a listed abbreviation is stored as the full entry");
eq(resolveHqCity("פ״ת"), "פתח תקווה", "the same abbreviation typed with a gershayim");
eq(resolveHqCity("פ''ת"), "פתח תקווה", "or with two apostrophes");
eq(resolveHqCity("ביל״ו"), "ביל\"ו", "an entry with a quote mark typed with a gershayim is the entry");
eq(resolveHqCity("רמלה לוד"), "רמלה לוד", "an exact entry is accepted");

// --- hqCityOptions: what the form offers -----------------------------------------
const options = hqCityOptions();
eq(options.includes("פתח תקווה"), true, "the options include פתח תקווה");
eq(options.includes("תל אביב-יפו"), true, "and תל אביב-יפו");
eq(options.some((o) => isRegionLocation(o)), false, "no region is offered");
eq(options.every((o) => isCanonicalLocation(o)), true, "every option is a city.csv entry");
eq(options.every((o) => resolveHqCity(o) === o), true, "every option passes the server gate unchanged");
eq(new Set(options).size, options.length, "no option twice");

// The form sends a city only when it is exactly one of the options, so a typed
// value is stopped before any request; the route's exact gate is behind it.
eq(isOfferedHqCity("פתח תקווה"), true, "an option is sendable");
eq(isOfferedHqCity("תקווה"), false, "a near miss is not sendable");
eq(isOfferedHqCity("Petah Tikva"), false, "an English name is not sendable");
eq(isOfferedHqCity(" פתח תקווה"), false, "nor an option with a stray space");
eq(isOfferedHqCity("אזור מרכז"), false, "nor a region");

// --- companyEditPlan: only changed keys; null only from a clear control ------------
const before: CompanyEditBefore = {
  companyHomepageUrl: "https://www.meyeden.co.il",
  companyAbout: "טקסט קיים",
  companyHqAddress: null,
  companyHqCity: "פתח תקווה",
};
const keep = (b: CompanyEditBefore): CompanyEditDraft => ({
  homepage: { value: b.companyHomepageUrl ?? "", clear: false },
  about: { value: b.companyAbout ?? "", clear: false },
  address: { value: b.companyHqAddress ?? "", clear: false },
  city: { value: b.companyHqCity ?? "", clear: false },
});

eq(companyEditPlan(before, keep(before)), { profile: {} }, "an untouched form sends nothing");
eq(
  companyEditPlan(before, { ...keep(before), about: { value: "טקסט חדש", clear: false } }),
  { profile: { companyAbout: "טקסט חדש" } },
  "a changed about sends only companyAbout",
);
eq(
  companyEditPlan(before, { ...keep(before), about: { value: "", clear: false } }),
  { profile: {} },
  "an emptied about textbox sends nothing: no null from an empty box",
);
eq(
  companyEditPlan(before, { ...keep(before), about: { value: "", clear: true } }),
  { profile: { companyAbout: null } },
  "the clear control sends null",
);
eq(
  companyEditPlan(before, { ...keep(before), about: { value: "  טקסט קיים  ", clear: false } }),
  { profile: {} },
  "whitespace around an unchanged value is no change",
);
eq(
  companyEditPlan(before, { ...keep(before), address: { value: "העודם 9", clear: false } }),
  { profile: { companyHqAddress: "העודם 9" } },
  "a first address is sent",
);
eq(
  companyEditPlan(before, { ...keep(before), address: { value: "", clear: true } }),
  { profile: {} },
  "clearing an address that is already empty sends nothing",
);
eq(
  companyEditPlan(before, { ...keep(before), city: { value: "תל אביב-יפו", clear: false } }),
  { city: "תל אביב-יפו", profile: {} },
  "a changed city goes to the HQ-city route",
);
eq(
  companyEditPlan(before, { ...keep(before), city: { value: "", clear: true } }),
  { city: null, profile: {} },
  "a cleared city sends null to the HQ-city route",
);
eq(
  companyEditPlan(before, { ...keep(before), homepage: { value: "https://www.meyeden.co.il/he/", clear: false } }),
  { homepage: "https://www.meyeden.co.il/he/", profile: {} },
  "a changed homepage goes to the homepage route",
);
eq(
  companyEditPlan(before, { ...keep(before), homepage: { value: "", clear: false } }),
  { profile: {} },
  "an emptied homepage box sends nothing",
);

// --- wiring ---------------------------------------------------------------------
const svc = readFileSync(join(__dirname, "..", "services", "siteService.ts"), "utf8");
const hq = svc.slice(svc.indexOf("export async function saveCompanyHqCity("));
const hqBody = hq.slice(0, hq.indexOf("\n}\n"));
eq(/const stored = resolveHqCity\(city\);/.test(hqBody), true, "saveCompanyHqCity gates through resolveHqCity");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("companyEdit: the HQ city is gated server-side, and the form sends only what changed");
