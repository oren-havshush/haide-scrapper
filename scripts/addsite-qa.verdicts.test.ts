// Run: npx tsx scripts/addsite-qa.verdicts.test.ts
//
// Report fixes 3, item 9 (the developer's 2026-10-19 to 20 report, item 4, and
// her 2026-10-21 report): QA sent shippable sites to REVIEW.
//   a. a Tier-B gap with Tier-A complete is ACTIVE, the gap in the note
//      (fnx.co.il, gal-hr.co.il: a "last updated" date not stored by decision);
//   b. the length check compares description plus requirements with the page
//      body (amit.co.il: short ads, most of each moved into requirements);
//   c. the location check is skipped on a vendor's detail page, with a note
//      (meptagon.com: the detail step is Niloos's apply page);
//   e. the slug-id suspect is not raised when the config says the slug is the
//      site's native id (_meta.externalJobIdNativeSlug; dsit.co.il).
// (d, the bare date word, is in scripts/lib/qaLabels.test.ts.)

import { computeCorrectnessSuspects, decideVerdict, readNativeSlugId } from "./addsite-qa";
import { updateSiteConfigSchema } from "../src/lib/validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- a. Tier-B gap, Tier-A complete ----------------------------------------------------------
{
  const base = {
    sampled: 12,
    tierAComplete: true,
    tierAMissing: [],
    formStatus: "CAPTURED" as const,
    availableButUnmapped: ["publishDate"],
    probeInconclusive: false,
    descMappingSuspect: false,
    correctnessSuspects: [] as string[],
  };
  const v = decideVerdict(base);
  assert(v.verdict === "ACTIVE", `a Tier-B gap alone is ACTIVE (got ${v.verdict}: ${v.reason})`);
  assert(/Tier-B exposed but unmapped: publishDate/.test(v.reason), `with the gap in the note (got ${v.reason})`);
  assert(decideVerdict({ ...base, availableButUnmapped: [] }).reason === "Tier-A complete + usable apply path", "no gap: the note as before");
  assert(decideVerdict({ ...base, correctnessSuspects: ["x"] }).verdict === "REVIEW", "a correctness suspect is still REVIEW");
  assert(decideVerdict({ ...base, formStatus: "NEEDS_MANUAL" }).verdict === "REVIEW", "and so is an uncaptured form");
}

const job = (over: Record<string, unknown>) => ({ title: "רכז/ת גיוס", rawData: {}, ...over });

// --- b. description plus requirements ----------------------------------------------------------
{
  const probe = { fieldsOnPage: { description: true } };
  const short = "משרה מלאה באזור המרכז, עבודה בצוות דינמי ומקצועי. " + "x".repeat(50);
  const split = Array.from({ length: 5 }, () => job({ description: short, requirements: "• ניסיון של שנתיים לפחות בגיוס\n".repeat(12) }));
  const s1 = computeCorrectnessSuspects(split, probe);
  assert(!s1.some((s) => /description present but avg/.test(s)), `a short ad with its body in requirements is not truncated (got ${JSON.stringify(s1)})`);
  const alone = Array.from({ length: 5 }, () => job({ description: short }));
  assert(computeCorrectnessSuspects(alone, probe).some((s) => /description present but avg/.test(s)), "a short description with nothing else still is");
}

// --- c. a vendor's detail page ------------------------------------------------------------------
{
  const probe = { fieldsOnPage: {}, detailBodyText: "הגשת מועמדות למשרה. שם מלא, טלפון, קורות חיים." };
  const jobs = Array.from({ length: 4 }, () => job({ location: "אזור מרכז" }));
  const notes: string[] = [];
  const onVendor = computeCorrectnessSuspects(jobs, probe, { probedUrl: "https://meptagon.niloosoft.co.il/Apply/4471", notes });
  assert(!onVendor.some((s) => /not found in detail page body/.test(s)), `on a vendor page the location is not checked (got ${JSON.stringify(onVendor)})`);
  assert(notes.includes("vendor detail page, location not checked"), `and the note says so (got ${JSON.stringify(notes)})`);
  const own = computeCorrectnessSuspects(jobs, probe, { probedUrl: "https://www.meptagon.com/jobs/4471", notes: [] });
  assert(own.some((s) => /not found in detail page body/.test(s)), "on the employer's own page it still is");
}

// --- e. a slug the config names as the native id -------------------------------------------------
{
  const slugJobs = ["field-engineer", "project-manager", "qa-team-lead"].map((slug) =>
    job({ title: slug.replace(/-/g, " "), externalJobId: slug, detailUrl: `https://www.dsit.co.il/careers/${slug}/` }),
  );
  assert(computeCorrectnessSuspects(slugJobs, null).some((s) => /looks like URL\/title slug/.test(s)), "the premise: slug ids are a suspect");
  const fm = { _meta: { externalJobIdNativeSlug: true } };
  assert(readNativeSlugId(fm) === true && readNativeSlugId({ _meta: {} }) === false && readNativeSlugId(null) === false, "readNativeSlugId reads _meta.externalJobIdNativeSlug");
  const s = computeCorrectnessSuspects(slugJobs, null, { nativeSlugId: true });
  assert(!s.some((x) => /looks like URL\/title slug/.test(x)), `not raised when the config says the slug is native (got ${JSON.stringify(s)})`);
  const body = {
    itemSelector: ".job",
    fieldMappings: { title: { selector: "h2", source: "MANUAL", confidence: 100 } },
    pageFlow: [{ url: "https://www.dsit.co.il/careers", action: "navigate" }],
    formCapture: null,
    externalJobIdNativeSlug: true,
  };
  assert(updateSiteConfigSchema.safeParse(body).success, "the config save accepts the key");
  assert(!updateSiteConfigSchema.safeParse({ ...body, externalJobIdNativeSlug: "yes" }).success, "as a boolean only");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("addsite-qa verdicts: a Tier-B gap is ACTIVE with a note; requirements count; vendor pages and native slugs not suspected");
