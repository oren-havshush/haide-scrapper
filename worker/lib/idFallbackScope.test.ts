// Run: npx tsx worker/lib/idFallbackScope.test.ts
//
// Report fixes 3, item 5 (2026-10-21; the developer's 10-20 reply, items 5 and
// 6): the text fallbacks for externalJobId (the labelled one, the description
// one and the bracketed-title one) run only on a site whose config maps no id.
// Where the config maps one and the page leaves it empty, the id stays empty
// and the worker's synthesizeJobId gives the h- id, as for any missing id. And
// no fallback reads an id out of a URL: nisha took JOB-164845 from the apply
// link printed in an ad.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapsExternalJobId } from "./fieldMappings";
import { normalizeJobRecord } from "./normalizer";
import { applyJobIdFallback } from "./synthesizeJobId";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

/** The id the worker would store for one record. */
function storedId(raw: Record<string, string>, configMapsId: boolean): string | null {
  const n = normalizeJobRecord(raw, { at: new Date("2026-10-21T00:00:00Z"), configMapsId } as Parameters<typeof normalizeJobRecord>[1]);
  return applyJobIdFallback([{ externalJobId: n.externalJobId, title: n.title, department: n.department, url: n.url }]).ids[0];
}

const labelled = {
  title: "Data Engineer",
  description: "We are hiring a data engineer.\nJob ID: JOB-1\nApply today.",
  _detailUrl: "https://x.test/jobs/data-engineer",
};

// --- a config that maps an id: no text fallback ----------------------------------------------
{
  const got = storedId({ ...labelled, externalJobId: "" }, true);
  assert(/^h-[0-9a-z]{1,7}$/.test(got ?? ""), `mapped id, empty on the page: the worker's h- id, not the text's (got ${got})`);
  const titled = storedId({ title: "Senior Analyst (JB-3086)", description: "Analysis work.", externalJobId: "", _detailUrl: "https://x.test/jobs/2" }, true);
  assert(/^h-/.test(titled ?? ""), `nor the bracketed title code (got ${titled})`);
  const desc = storedId({ title: "Clerk", description: "Office work. REQ-2231 open now.", externalJobId: "", _detailUrl: "https://x.test/jobs/3" }, true);
  assert(/^h-/.test(desc ?? ""), `nor the description's code (got ${desc})`);
  assert(storedId({ ...labelled, externalJobId: "778" }, true) === "778", "the mapped value itself is kept");
}

// --- a config that maps no id: the fallbacks as before ---------------------------------------
{
  assert(storedId(labelled, false) === "JOB-1", `no id mapped: the labelled JOB-1 (got ${storedId(labelled, false)})`);
  assert(storedId({ title: "Senior Analyst (JB-3086)", description: "Analysis work.", _detailUrl: "https://x.test/jobs/2" }, false) === "JB-3086", "and the bracketed title code");
}

// --- never out of a URL ------------------------------------------------------------------------
{
  // nisha (Yad Vashem's ad), 2026-10-20, as stored.
  const nisha = "פרטים נוספים\n• הגשת קורות חיים עד לתאריך 11/6/2026 בשעה 12:00 בלינק – https://yadvashemcareers.org/jobs/job-164845\n• ועדת המכרזים תתכנס בתאריך16/6/2026";
  const got = storedId({ title: "מומחה/ית אבטחת מידע", description: nisha, _detailUrl: "https://www.nisha.co.il/job/1" }, false);
  assert(/^h-/.test(got ?? ""), `an id inside a link is not taken (got ${got})`);
  const hrefOnly = storedId({ title: "Engineer", description: "Job ID: https://x.test/apply?job=JOB-77\nGreat team.", _detailUrl: "https://x.test/jobs/4" }, false);
  assert(/^h-/.test(hrefOnly ?? ""), `a labelled value whose only source is a URL is not taken (got ${hrefOnly})`);
  const wwwOnly = storedId({ title: "Engineer", description: "פרטים: www.x.test/jobs/REQ-5512", _detailUrl: "https://x.test/jobs/5" }, false);
  assert(/^h-/.test(wwwOnly ?? ""), `nor one in a www. address (got ${wwwOnly})`);
  const beside = storedId({ title: "Engineer", description: "מספר משרה: 4410\nלהגשה: https://x.test/apply/JOB-9", _detailUrl: "https://x.test/jobs/6" }, false);
  assert(beside === "4410", `a printed number beside a link is still read (got ${beside})`);
}

// --- what counts as mapping an id, and the wiring -----------------------------------------------
{
  assert(mapsExternalJobId({ externalJobId: { selector: "[data-id]", source: "MANUAL" } }), "a selector maps it");
  assert(!mapsExternalJobId({ externalJobId: { selector: "  " } }) && !mapsExternalJobId({ title: { selector: "h2" } }) && !mapsExternalJobId(null), "an empty selector or none does not");
  const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  assert(/normalizeJobRecord\(rawFields, \{ at: normalizedAt, configMapsId \}\)/.test(src), "scrape.ts passes configMapsId to the normaliser");
  assert(/const configMapsId =\s*mapsExternalJobId\(site\.fieldMappings\)/.test(src), "computed from the site's mappings");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("idFallbackScope: text id fallbacks only where no id is mapped, and never out of a URL");
