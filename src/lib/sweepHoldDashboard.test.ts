// Run: npx tsx src/lib/sweepHoldDashboard.test.ts
//
// The dashboard's view of a hold (G7, owner 2026-10-13): the badge beside the
// status with the vendor read through holdVendor, its tooltip with the release
// command (no release button: release is the owner's word), the ?hold=1 filter
// in the strict list query and its where-clause, and the held and paused counts
// beside the status tabs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { holdBadgeText, holdBadgeTitle, holdListWhere, holdReleaseCommand } from "./sweepHold";
import { siteListQuerySchema } from "./validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const one1 = { id: "s-one1", sweepHold: "HOST_CHALLENGE", sweepHoldAt: "2026-10-13T16:49:51.359Z", sweepHoldNote: "Cloudflare challenge on headless browsers since 2026-10-09 (one1)", sweepHoldBy: null, sweepHoldProbeAt: null, sweepHoldProbeResult: null };
const tlcare = { id: "s-tl", sweepHold: "HOST_CHALLENGE", sweepHoldAt: "2026-10-13T16:49:48.624Z", sweepHoldNote: "SiteGround interactive challenge on the box IP since 2026-10-12 (tl-care) / 2026-10-13 (eso-group)", sweepHoldBy: null, sweepHoldProbeAt: "2026-10-16T23:01:05Z", sweepHoldProbeResult: "still challenged: SiteGround challenge (sg-captcha: challenge)" };
const paused = { id: "s-cf", sweepHold: "CHALLENGE_RETRY_SATURDAY", sweepHoldAt: "2026-10-13T23:40:00Z", sweepHoldNote: "auto: Cloudflare challenge on 2026-10-14; retry Saturday night", sweepHoldBy: "auto", sweepHoldProbeAt: null, sweepHoldProbeResult: null };

check("the badge", () => {
  assert(holdBadgeText(one1) === "On hold: Cloudflare challenge since 2026-10-13", `one1 (got ${holdBadgeText(one1)})`);
  assert(holdBadgeText(tlcare) === "On hold: SiteGround challenge since 2026-10-13", `tl-care (got ${holdBadgeText(tlcare)})`);
  assert(holdBadgeText(paused) === "Paused: Cloudflare challenge since 2026-10-14, retry Saturday", `a pause (got ${holdBadgeText(paused)})`);
  assert(holdBadgeText({ ...one1, sweepHoldNote: "held by hand" }) === "On hold: host challenge since 2026-10-13", "a note naming no host says host");
  assert(holdBadgeText({ ...one1, sweepHold: null }) === null, "no badge without a hold");
});

check("the tooltip: note, who, probe, guarded runs, the release command", () => {
  const t = holdBadgeTitle(one1);
  assert(t.includes(one1.sweepHoldNote) && t.includes("set by the owner"), "the note, and NULL read as the owner");
  assert(t.includes("not probed: a GET cannot pass Cloudflare"), "a Cloudflare hold is never probed");
  assert(t.includes(`release (the owner's word): npx tsx scripts/addsite-batch.ts hold release --site s-one1`), "the release command to copy");
  assert(holdBadgeTitle(tlcare).includes("probe 2026-10-17: still challenged: SiteGround challenge (sg-captcha: challenge)"), "a SiteGround hold shows its last probe");
  assert(holdBadgeTitle(paused).includes("set by the nightly") && holdBadgeTitle(paused).includes("retried by the Saturday-night run"), "a pause says who and what next");
  assert(holdReleaseCommand("x") === "npx tsx scripts/addsite-batch.ts hold release --site x", "the command");
});

check("the filter: ?hold=1 in the strict query, and its where-clause", () => {
  assert(siteListQuerySchema.safeParse({ hold: "1" }).success, "?hold=1 is allowed");
  assert(!siteListQuerySchema.safeParse({ hold: "yes" }).success, "only the value 1");
  assert(!siteListQuerySchema.safeParse({ held: "1" }).success, "and the query stays strict");
  assert(JSON.stringify(holdListWhere("1")) === JSON.stringify({ sweepHold: { not: null } }), "held or paused sites only");
  assert(JSON.stringify(holdListWhere(undefined)) === "{}", "no filter by default");
});

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

check("the wiring", () => {
  const badge = read("src/components/shared/SweepHoldBadge.tsx");
  assert(/holdBadgeText\(site\)/.test(badge) && /holdBadgeTitle\(site\)/.test(badge), "the badge reads its words through holdBadgeText (and so holdVendor)");
  assert(!/challengeVendor|Cloudflare|SiteGround/.test(badge), "and never names a vendor itself");
  const table = read("src/components/sites/SitesTable.tsx");
  assert(/<StatusBadge status=\{site\.status\} \/>\s*<SweepHoldBadge site=\{site\} \/>/.test(table), "beside the status in the row");
  assert(/hold=\{site\.sweepHold \? site : null\}/.test(table), "and handed to the actions menu");
  const actions = read("src/components/sites/SiteActions.tsx");
  assert(/holdReleaseCommand\(siteId\)/.test(actions) && /<SweepHoldBadge site=\{hold\} \/>/.test(actions), "the menu's title line shows the hold and copies the release command");
  assert(!/sweep-hold/.test(actions), "no release button: nothing in the menu calls the hold route");
  const svc = read("src/services/siteService.ts");
  const list = svc.slice(svc.indexOf("export async function listSites"), svc.indexOf("export async function getStatusCounts"));
  assert(/Object\.assign\(where, holdListWhere\(hold\)\)/.test(list), "listSites applies the filter");
  const counts = svc.slice(svc.indexOf("export async function getStatusCounts"), svc.indexOf("export async function getStatusCounts") + 1500);
  assert(/by: \["sweepHold"\]/.test(counts) && /onHold, paused \}/.test(counts), "getStatusCounts counts held and paused sites");
  assert(/hold: q\.hold,/.test(read("src/app/api/sites/route.ts")), "the list route passes the filter");
  assert(/searchParams\.set\("hold", hold\)/.test(read("src/hooks/useSites.ts")), "the hook sends it");
  assert(/On hold/.test(read("src/components/sites/SiteSearchFilters.tsx")), "the filters have the On hold toggle");
  assert(/counts\?\.onHold/.test(read("src/components/sites/SiteStatusTabs.tsx")) && /counts\?\.paused/.test(read("src/components/sites/SiteStatusTabs.tsx")), "the tabs show the counts, not as tabs");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("sweepHoldDashboard: all assertions passed");
