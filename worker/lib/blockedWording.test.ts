// Run: npx tsx worker/lib/blockedWording.test.ts
//
// The blocked line says what the wait saw (owner, 2026-10-12). "nothing tried
// to pass it" was untrue once the SiteGround wait existed. After a wait that
// failed, the line says what the wait saw; with no wait, it says "no wait ran"
// and why.

import { needsAttention, type ReportItem, type ReportSweep } from "./sweepReport";

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error("FAIL:", m); failures++; } };

const SWEEP: ReportSweep = { id: "sw", kind: "SCRAPE", status: "COMPLETED", trigger: "timer", startedAt: new Date("2026-10-11T23:01:00Z"), finishedAt: new Date("2026-10-12T00:42:30Z"), selectedCount: 3, haltReason: null };
const item = (o: Partial<ReportItem>): ReportItem => ({ siteId: "s", siteUrl: "https://s.test", phase: "scrape", outcome: "success", failureCategory: null, jobsBefore: 1, jobsAfter: 1, newestJobAt: null, siteStatus: "ACTIVE", wouldDemoteTo: null, wouldPromoteTo: null, ...o });
const why = (warnings: string[], jobs = 16) =>
  needsAttention(SWEEP, [item({ siteId: "b", siteUrl: "https://b.test", outcome: "soft_failure", failureCategory: "blocked", jobsBefore: jobs, jobsAfter: jobs, warnings }), item({ siteId: "a" }), item({ siteId: "c" })])[0]?.why ?? "";

const SG = "blocked_challenge: SiteGround challenge (sg-captcha: challenge)";
const tl = why(["item_selector_zero_match: .elementor-accordion .elementor-accordion-item", SG, "challenge_wait: SiteGround interactive captcha after 11.5 s — blocked"]);
assert(
  tl === `blocked: the listing was a SiteGround challenge ("SiteGround challenge (sg-captcha: challenge)"), not the site — nothing written, 16 listing(s) kept; the wait saw SiteGround interactive captcha after 11.5 s`,
  `tl-care: the line says what the wait saw (got "${tl}")`,
);
const cap = why([SG, "challenge_wait: SiteGround ipr did not settle within 20 s — blocked"], 2);
assert(/; the wait saw SiteGround ipr did not settle within 20 s$/.test(cap), `the cap: named (got "${cap}")`);
const CF_TITLE = String.fromCharCode(0x5e8, 0x5e7, 0x20, 0x5e8, 0x5d2, 0x5e2) + "...";
const cf = why(["item_selector_zero_match: body #haide-jobs-root [data-haide-job]", `blocked_challenge: ${CF_TITLE}`], 157);
assert(/; no wait ran \(Cloudflare is not waited for\)$/.test(cf), `one1: no wait ran, with the reason (got "${cf}")`);
const sgNone = why([SG], 2);
assert(/; no wait ran \(no SiteGround chain was recorded on the listing navigation\)$/.test(sgNone), `SiteGround with no record: no wait ran, why (got "${sgNone}")`);
for (const s of [tl, cap, cf, sgNone]) assert(!/nothing tried to pass it/.test(s), `never "nothing tried to pass it" (got "${s}")`);
if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log("blockedWording: the blocked line says what the wait saw, or that none ran and why");
