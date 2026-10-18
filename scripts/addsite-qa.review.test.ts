// Run: npx tsx scripts/addsite-qa.review.test.ts
//
// QA sent correct sites to REVIEW (developer's report 2026-10-18, item 4):
//   - a cookie banner's "Apply" button was read as an apply form (תן ביס);
//   - a page-level lead form won over the jobs' own apply links or emails
//     (afeka, leumi);
//   - a location spelled through the site's locationMap or by its short form
//     was called suspect because the page spelled it differently ("קדימה" on
//     the page for the stored "קדימה צורן"; bynet, brooks-keret, elmomc).

import { classifyFormStatus, computeCorrectnessSuspects, locationOnPage, probeDetail } from "./addsite-qa";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const page = (body: string) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><body>${body}</body></html>`);
const JOB = "<h1>נציג/ת מכירות</h1><p>" + "תיאור המשרה. ".repeat(40) + "</p>";

// --- consent panels ---------------------------------------------------------------------
(async () => {
  const withBanner = await probeDetail(
    page(
      JOB +
        `<div id="cookie-consent" class="cc-window"><p>אנו משתמשים בעוגיות</p><button>Apply</button>` +
        `<form><input name="a"><input name="b"><input name="c"><button>שמור</button></form></div>` +
        `<div role="dialog" aria-label="Privacy consent"><a href="#">Apply settings</a></div>`,
    ),
    false,
    "",
  );
  assert(withBanner !== null, "the probe ran");
  assert(withBanner?.modalApplyButton === false, `a cookie banner's "Apply" button is not an apply form (got ${withBanner?.modalApplyButton})`);
  assert(withBanner?.formCount === 0 && withBanner?.maxFormFields === 0, `a form inside the consent panel is not counted (got ${withBanner?.formCount}/${withBanner?.maxFormFields})`);

  const withApply = await probeDetail(page(JOB + `<button class="apply-btn">הגשת מועמדות</button>`), false, "");
  assert(withApply?.modalApplyButton === true, "a real apply button on the page is still seen");

  const bodyClass = await probeDetail(
    "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><body class="cookies-not-set">${JOB}<button>הגשת מועמדות</button></body></html>`),
    false,
    "",
  );
  assert(bodyClass?.modalApplyButton === true, "a consent plugin's body class does not hide the page's own apply button");

  // --- the jobs' own apply path wins over a page-level lead form --------------------------
  const leadForm = { maxFormFields: 4, modalApplyButton: true, externalApply: false };
  assert(
    classifyFormStatus({ hasFormCapture: false, jobApply: ["jobs@afeka.ac.il", "mailto:hr@afeka.ac.il"], probe: leadForm, anyEmail: true, anyUrlApply: false }) === "EMAIL",
    "every job has its own email: EMAIL, not NEEDS_MANUAL",
  );
  assert(
    classifyFormStatus({ hasFormCapture: false, jobApply: ["https://leumi.co.il/apply/1", "https://leumi.co.il/apply/2"], probe: leadForm, anyEmail: false, anyUrlApply: true }) === "URL",
    "every job has its own apply link: URL",
  );
  assert(
    classifyFormStatus({ hasFormCapture: false, jobApply: ["jobs@x.co.il", null], probe: leadForm, anyEmail: true, anyUrlApply: false }) === "NEEDS_MANUAL",
    "one job without its own path: the page form still counts",
  );
  assert(
    classifyFormStatus({ hasFormCapture: true, jobApply: ["jobs@x.co.il"], probe: leadForm, anyEmail: true, anyUrlApply: false }) === "CAPTURED",
    "a captured form still comes first",
  );
  assert(
    classifyFormStatus({ hasFormCapture: false, jobApply: [], probe: null, anyEmail: false, anyUrlApply: false }) === "NONE",
    "nothing sampled, nothing found: NONE",
  );

  // --- the location check ------------------------------------------------------------------
  const body = "המשרה ממוקמת בקדימה, ליד הכיכר. פ\"ת והסביבה".toLowerCase();
  const map = { "קדימה": "קדימה צורן", "השרון": "אזור השרון" };
  assert(locationOnPage("קדימה צורן", body, map), "\"קדימה\" on the page, a locationMap key for קדימה צורן, accepts it");
  assert(locationOnPage("קדימה-צורן", body, map), "and the hyphenated spelling");
  assert(locationOnPage("פתח תקווה", body, null), "a short form from the alias table ('פ\"ת') accepts פתח תקווה");
  assert(!locationOnPage("קדימה צורן", body, null), "with no map entry and no alias, קדימה צורן is not on this page");
  assert(!locationOnPage("חיפה", body, map), "a city the page does not name is not accepted");

  const jobs = Array.from({ length: 4 }, () => ({ location: "קדימה צורן" }));
  const probe = { fieldsOnPage: {}, detailBodyText: "המשרה ממוקמת בקדימה" };
  assert(computeCorrectnessSuspects(jobs, probe, { locationMap: map }).length === 0, "computeCorrectnessSuspects raises no location suspect for the mapped spelling");
  assert(computeCorrectnessSuspects(jobs, probe).length === 1, "without the map it still does");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("addsite-qa.review: consent panels ignored, the jobs' own apply path wins, mapped and short location spellings accepted");
})().catch((e) => {
  console.error(`FAIL: test threw — ${(e as Error).message}`);
  process.exit(1);
});
