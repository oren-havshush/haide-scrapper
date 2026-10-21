// Run: npx tsx src/lib/operatorWrites.test.ts
//
// Report fixes 3, item 12 (the developer's 2026-10-19 to 20 report, item 7):
// values set by hand through the API were not protected from a --force
// re-capture.
//   - Both company routes record operator fields for every hand write, the
//     operator token's included, not only the dashboard's. The capture marks
//     its own writes (?capture=1), which are not hand writes.
//   - A stored companyHqCitySource of operator:none is a human answer ("this
//     company prints no HQ"): the capture leaves city and address out of its
//     payload (presence-based writes: an omitted key changes nothing, a null
//     clears).

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// --- the routes (HEAD records for the dashboard only) ---------------------------------------------
{
  const profile = read("src/app/api/sites/[id]/company-profile/route.ts");
  const homepage = read("src/app/api/sites/[id]/company-homepage/route.ts");
  assert(!/if \(isDashboardRequest\(request\)\) await recordOperatorFields/.test(profile), "company-profile: not the dashboard's writes only");
  assert(/if \(!isCaptureWrite\(request\.nextUrl\.searchParams\)\) await recordOperatorFields\(id, parsed\.data\)/.test(profile), "company-profile: every write but the capture's is recorded");
  assert(!/if \(isDashboardRequest\(request\)\) await recordOperatorFields/.test(homepage), "company-homepage: not the dashboard's writes only");
  assert(/await recordOperatorFields\(id, \{ companyHomepageUrl: site\.companyHomepageUrl \}\)/.test(homepage), "company-homepage: every write is recorded (the capture never writes it)");
  const capture = read("scripts/company-profile.ts");
  assert(/company-profile\?\$\{captureQuery\(force\)\}/.test(capture), "the capture marks its own write");
  assert(/withoutHumanHqAnswer\(/.test(capture), "and leaves a human HQ answer alone");
}

(async () => {
  const { captureQuery, isCaptureWrite, withoutHumanHqAnswer } = await import("./operatorFields");

  // --- the capture's marker -------------------------------------------------------------------------
  assert(captureQuery(false) === "capture=1" && captureQuery(true) === "capture=1&force=1", `the query (got ${captureQuery(true)})`);
  assert(isCaptureWrite(new URLSearchParams("capture=1&force=1")) && !isCaptureWrite(new URLSearchParams("force=1")) && !isCaptureWrite(new URLSearchParams("")), "only ?capture=1 is the capture");

  // --- operator:none ----------------------------------------------------------------------------------
  const payload = {
    companyHomepageUrl: "https://www.handasi.co.il/",
    companyAbout: "הנדסי היא חברה ...",
    companyHqAddress: "רחוב הברזל 3, תל אביב",
    companyHqCity: "תל אביב-יפו",
    companyProfileStatus: "COMPLETE",
  };
  const none = withoutHumanHqAnswer(payload, "operator:none");
  assert(!("companyHqCity" in none) && !("companyHqAddress" in none), `operator:none: city and address left out (got ${JSON.stringify(Object.keys(none))})`);
  assert(none.companyAbout === payload.companyAbout && none.companyProfileStatus === "COMPLETE", "the rest is sent");
  assert(JSON.stringify(withoutHumanHqAnswer(payload, null)) === JSON.stringify(payload), "no source: the payload as it is");
  assert(JSON.stringify(withoutHumanHqAnswer(payload, "skill")) === JSON.stringify(payload), "a city the skill supplied is handled by the authored-city path, unchanged");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("operatorWrites: hand writes through the API are protected; operator:none keeps city and address out of a capture");
})().catch((e) => {
  console.error(`FAIL: operatorWrites test threw — ${(e as Error).message}`);
  process.exit(1);
});
