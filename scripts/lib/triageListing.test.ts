// Run: npx tsx scripts/lib/triageListing.test.ts
//
// Triage misread the listing (developer's report 2026-10-18, item 5):
//   - menus, carousels and grids were counted as the job list: a cluster now
//     counts only when most of its members look like jobs (a link or heading
//     of 3 to 12 words, outside any nav or footer);
//   - an unknown vendor's iframe was missed: any cross-origin iframe taller
//     than 300 px is reported, vendor "unknown-iframe";
//   - wordpress-job-cpt was set from a word list alone: it now needs
//     /wp-json/wp/v2/types to list a job type;
//   - an iframe address kept "&amp;": it is entity-decoded.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  decodeHtmlEntities,
  embeddedBoardFrom,
  jobLikeClusterSize,
  LISTING_PROBE_JS,
  wpTypesHaveJobType,
  type ListingProbe,
} from "./triageRules";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const MENU_PAGE = `<!doctype html><html><body>
<nav><ul class="menu">${["בית", "אודות", "שירותים", "לקוחות", "צור קשר", "בלוג", "קריירה", "חדשות"].map((t) => `<li class="menu-item"><a href="/${t}">${t}</a></li>`).join("")}</ul></nav>
<div class="logos">${Array.from({ length: 10 }, (_, i) => `<div class="logo-slide"><img src="/l${i}.png" alt=""></div>`).join("")}</div>
<footer><ul>${["תנאי שימוש", "פרטיות", "נגישות"].map((t) => `<li class="f-item"><a href="#">${t}</a></li>`).join("")}</ul></footer>
</body></html>`;
const JOBS_PAGE = `<!doctype html><html><body>
<nav><ul class="menu">${["בית", "אודות", "קריירה"].map((t) => `<li class="menu-item"><a href="#">${t}</a></li>`).join("")}</ul></nav>
<ul class="jobs">${["מהנדס/ת תוכנה בכיר/ה לצוות התשתיות", "נציג/ת שירות לקוחות במוקד הטלפוני", "מנהל/ת חשבונות לחברה גדולה במרכז", "טכנאי/ת שטח לאזור הצפון והשרון", "אחראי/ת משמרת במחסן הלוגיסטי"].map((t, i) => `<li class="job-card"><h3><a href="/job/${i}">${t}</a></h3><span>מרכז</span></li>`).join("")}</ul>
<iframe src="https://boards.talentflow.co.il/embed?company=mega&amp;lang=he" style="height:900px;width:100%"></iframe>
<iframe src="https://www.youtube.com/embed/xyz" style="height:360px;width:640px"></iframe>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://boards.talentflow.co.il/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>board</p>" }));
    await page.route("https://www.youtube.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>video</p>" }));

    await page.setContent(MENU_PAGE);
    const menu = (await page.evaluate(LISTING_PROBE_JS)) as ListingProbe;
    const rawMax = Math.max(...menu.clusters.map((c) => c.members.length));
    assert(rawMax >= 8, `the menu page has big clusters by the old count (got ${rawMax})`);
    assert(jobLikeClusterSize(menu.clusters) === 0, `a page whose largest cluster is a menu reports no listing (got ${jobLikeClusterSize(menu.clusters)})`);

    await page.setContent(JOBS_PAGE);
    const jobs = (await page.evaluate(LISTING_PROBE_JS)) as ListingProbe;
    assert(jobLikeClusterSize(jobs.clusters) === 5, `the job cards are the listing (got ${jobLikeClusterSize(jobs.clusters)})`);

    const known = (h: string) => (/(^|\.)comeet\.(com|co)$/.test(h) ? { vendor: "comeet", recipe: "recipes/spa-frameworks.md#comeet" } : null);
    const board = embeddedBoardFrom(jobs.frames, "www.mega-talents.co.il", known);
    assert(board?.vendor === "unknown-iframe", `a tall cross-origin iframe of an unknown vendor is reported (got ${JSON.stringify(board)})`);
    assert(board?.url === "https://boards.talentflow.co.il/embed?company=mega&lang=he", `with "&amp;" decoded to "&" (got ${board?.url})`);
  } finally {
    await browser.close();
  }

  // The frame rules, pure.
  const known = (h: string) => (/(^|\.)comeet\.(com|co)$/.test(h) ? { vendor: "comeet", recipe: "recipes/spa-frameworks.md#comeet" } : null);
  assert(embeddedBoardFrom([{ src: "https://www.youtube.com/embed/x", height: 400 }], "a.co.il", known) === null, "a tall video iframe is not a board");
  assert(embeddedBoardFrom([{ src: "https://vendor.test/board", height: 200 }], "a.co.il", known) === null, "an unknown iframe of 300 px or less is not reported");
  assert(embeddedBoardFrom([{ src: "https://a.co.il/board", height: 900 }], "a.co.il", known) === null, "a same-origin iframe is not an embedded board");
  assert(embeddedBoardFrom([{ src: "https://www.comeet.com/jobs/x/1", height: 0 }], "a.co.il", known)?.vendor === "comeet", "a known ATS iframe is reported at any size");
  assert(
    embeddedBoardFrom([{ src: "https://vendor.test/board", height: 900 }, { src: "https://www.comeet.com/jobs/x/1", height: 50 }], "a.co.il", known)?.vendor === "comeet",
    "a known ATS wins over an unknown tall iframe",
  );
  assert(decodeHtmlEntities("a=1&amp;b=2&#38;c=3&#x26;d=&quot;4&quot;") === 'a=1&b=2&c=3&d="4"', "entities are decoded");

  // The WordPress REST index.
  assert(wpTypesHaveJobType({ post: { slug: "post", name: "Posts" }, jobs: { slug: "jobs", name: "Jobs" } }), "a jobs type is listed");
  assert(wpTypesHaveJobType({ positions: { slug: "open-positions", name: "Open Positions" } }), "a slug carrying a job word counts");
  assert(wpTypesHaveJobType({ x: { slug: "%d7%9e%d7%a9%d7%a8%d7%95%d7%aa", name: "x" } }), "a percent-encoded Hebrew slug counts");
  assert(!wpTypesHaveJobType({ post: { slug: "post", name: "Posts" }, page: { slug: "page", name: "Pages" }, attachment: { slug: "attachment", name: "Media" } }), "WordPress's own types are not a job type (bynet)");
  assert(!wpTypesHaveJobType(null) && !wpTypesHaveJobType("<html>"), "an unreadable index confirms nothing");

  // The wiring in addsite-batch.ts.
  const src = readFileSync(join(__dirname, "..", "addsite-batch.ts"), "utf8");
  const triage = src.slice(src.indexOf("async function cmdTriage("), src.indexOf("// fix — one site's config fix"));
  assert(/topCluster = jobLikeClusterSize\(probe\.clusters\);/.test(triage), "triage counts only job-like clusters");
  assert(/embedded = embeddedBoardFrom\(frames, host, knownIframeHost\);/.test(triage), "triage reports a tall unknown iframe from the rendered page");
  assert(/if \(await wpJobTypeConfirmed\(url\)\) vendor = "wordpress-job-cpt";/.test(triage), "triage sets wordpress-job-cpt only on the REST index's word");
  assert(/return embeddedBoardFrom\(frames, pageHost, knownIframeHost\);/.test(src), "findEmbeddedBoardUrl decodes through embeddedBoardFrom");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("triageListing: job-like clusters only, tall unknown iframes reported and decoded, job post types confirmed by the REST index");
})().catch((e) => {
  console.error(`FAIL: test threw — ${(e as Error).message}`);
  process.exit(1);
});
