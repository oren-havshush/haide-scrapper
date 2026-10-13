// Run: npx tsx worker/lib/sweepReportHold.test.ts
//
// The morning email's On hold block (G6, owner 2026-10-13): right after Needs
// attention, an ACTION line first when a paused site was blocked again on
// Saturday, each held site with what to say, Cloudflare's pauses under their
// own heading, the verdict line's counts, one count line in the skipped list,
// and the mailer setting the ACTION line in bold.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSweepReport, type HoldReport, type ReportItem, type ReportSweep } from "./sweepReport";
import { buildMailBody } from "./sweepMail";

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

const TZ = "Asia/Jerusalem";
const sweep: ReportSweep = {
  id: "w1",
  kind: "SCRAPE",
  status: "COMPLETED",
  trigger: "timer",
  startedAt: new Date("2026-10-16T23:01:00Z"),
  finishedAt: new Date("2026-10-17T01:30:00Z"),
  selectedCount: 3,
  haltReason: null,
};
const item = (siteUrl: string, over: Partial<ReportItem> = {}): ReportItem => ({
  siteId: siteUrl,
  siteUrl,
  phase: "scrape",
  outcome: "success",
  failureCategory: null,
  jobsBefore: 10,
  jobsAfter: 10,
  newestJobAt: new Date("2026-10-17T00:00:00Z"),
  siteStatus: "ACTIVE",
  wouldDemoteTo: null,
  wouldPromoteTo: null,
  ...over,
});
const items = [
  item("https://www.ok.example/"),
  item("https://y.example/"),
  item("https://x.example/", { outcome: "soft_failure", failureCategory: "blocked", warnings: ["blocked_challenge: Cloudflare challenge (cf-mitigated: challenge)"] }),
];
const d = (s: string) => new Date(s);
const holds: HoldReport = {
  sites: [
    { siteUrl: "https://www.one1.co.il/", hold: "HOST_CHALLENGE", vendor: "Cloudflare", since: d("2026-10-13T16:49:51Z"), by: "owner", note: "Cloudflare challenge on headless browsers since 2026-10-09 (one1)", jobs: 157, probeAt: null, probeResult: null },
    { siteUrl: "https://tl-care.co.il/", hold: "HOST_CHALLENGE", vendor: "SiteGround", since: d("2026-10-13T16:49:48Z"), by: "owner", note: "SiteGround interactive challenge", jobs: 16, probeAt: d("2026-10-16T23:01:05Z"), probeResult: "passed; the run passed" },
    { siteUrl: "https://eso-group.co.il/", hold: "HOST_CHALLENGE", vendor: "SiteGround", since: d("2026-10-13T16:49:45Z"), by: "owner", note: "SiteGround interactive challenge", jobs: 2, probeAt: null, probeResult: null, runPassedAt: d("2026-10-15T09:00:00Z") },
    { siteUrl: "https://blocked.example/", hold: "HOST_CHALLENGE", vendor: "SiteGround", since: d("2026-10-10T23:30:00Z"), by: "auto", note: "auto: SiteGround challenge (interactive captcha) on 3 nights, 2026-10-09..2026-10-11", jobs: 5, probeAt: d("2026-10-16T23:01:06Z"), probeResult: "passed; the run was blocked" },
    { siteUrl: "https://x.example/", hold: "CHALLENGE_RETRY_SATURDAY", vendor: "Cloudflare", since: d("2026-10-13T23:40:00Z"), by: "auto", note: "auto: Cloudflare challenge on 2026-10-14; retry Saturday night", jobs: 12, probeAt: null, probeResult: null },
  ],
  events: [
    { siteUrl: "https://x.example/", action: "pause_stays", blockedAgain: true, why: "Cloudflare blocked on Saturday too" },
    { siteUrl: "https://y.example/", action: "lift_pause" },
  ],
};
const skipped = [
  { siteUrl: "https://www.one1.co.il/", reason: "on hold (HOST_CHALLENGE): Cloudflare challenge on headless browsers since 2026-10-09 (one1)", kind: "hold" as const },
  { siteUrl: "https://eso-group.co.il/", reason: "on hold (HOST_CHALLENGE): SiteGround interactive challenge", kind: "hold" as const },
  { siteUrl: "https://nomap.example/", reason: "no usable fieldMappings (would fail immediately)" },
];

check("the On hold block", () => {
  const text = renderSweepReport(sweep, items, { timeZone: TZ, skipped, holds });
  const lines = text.split("\n");
  assert(/^Nightly sweep 2026-10-17: 3 sites, \d+ need attention, 4 on hold, 1 paused$/.test(lines[0]), `the verdict line counts held and paused (got "${lines[0]}")`);
  const attention = lines.findIndex((l) => l.startsWith("Needs attention ("));
  const onHold = lines.indexOf("On hold (4)");
  const outcomes = lines.indexOf("Outcomes");
  assert(attention >= 0 && onHold > attention && onHold < outcomes, `the block follows Needs attention (attention ${attention}, on hold ${onHold}, outcomes ${outcomes})`);
  const between = lines.slice(attention + 1, onHold).filter((l) => /^[A-Z]/.test(l));
  assert(between.length === 0, `nothing comes between them (got ${JSON.stringify(between)})`);
  assert(lines[onHold + 1] === "ACTION: say hold x.example (Cloudflare blocked on Saturday too)", `the ACTION line is first, on its own line (got "${lines[onHold + 1]}")`);
  const has = (l: string) => assert(lines.includes(l), `has the line "${l}"`);
  has("  www.one1.co.il — Cloudflare, held since 2026-10-13 by the owner, 157 listing(s) kept");
  has("      held by the owner since 2026-10-13; say run www.one1.co.il to test with the browser");
  has("  tl-care.co.il — SiteGround, held since 2026-10-13 by the owner, 16 listing(s) kept");
  has("      probe 2026-10-17: probe passed and the run passed: say release tl-care.co.il");
  has("      not probed yet (next: the Saturday-night run); a guarded run passed on 2026-10-15: say release eso-group.co.il");
  has("  blocked.example — SiteGround, held since 2026-10-11 by the nightly, 5 listing(s) kept");
  has("      probe 2026-10-17: probe passed but the run was blocked: hold stays");
  has("Cloudflare, retry Saturday (1)");
  has("  x.example — paused since 2026-10-14, 12 listing(s) kept; retried by the Saturday-night run");
  has("  x.example: blocked on Saturday too; the pause stays until the owner says hold");
  has("  y.example: Cloudflare pause lifted, run passed");
  assert(!text.includes("on hold (HOST_CHALLENGE)"), "the skipped list no longer names the held sites");
  has("    2 on hold, 0 paused (see On hold)");
  has("    https://nomap.example/ — no usable fieldMappings (would fail immediately)");
});

check("held or paused tonight: one line under Needs attention", () => {
  const tonight: HoldReport = {
    sites: [],
    events: [
      { siteUrl: "https://sg.example/", action: "hold", note: "auto: SiteGround challenge (interactive captcha) on 3 nights, 2026-10-12..2026-10-14" },
      { siteUrl: "https://cf.example/", action: "pause", note: "auto: Cloudflare challenge on 2026-10-14; retry Saturday night" },
    ],
  };
  const text = renderSweepReport({ ...sweep, startedAt: d("2026-10-13T23:01:00Z") }, [item("https://www.ok.example/")], { timeZone: TZ, holds: tonight });
  assert(text.includes("  https://sg.example/\n      held tonight: auto: SiteGround challenge (interactive captcha) on 3 nights, 2026-10-12..2026-10-14; listings kept"), "the hold is named once");
  assert(text.includes("  https://cf.example/\n      paused tonight: auto: Cloudflare challenge on 2026-10-14; retry Saturday night; listings kept"), "and the pause");
  assert(/need attention$/.test(text.split("\n")[0]) && /2 need attention/.test(text.split("\n")[0]), `both count (got "${text.split("\n")[0]}")`);
});

check("without holds the report is as before", () => {
  const before = renderSweepReport(sweep, items, { timeZone: TZ, skipped });
  assert(!before.includes("On hold"), "no block");
  assert(/need attention$/.test(before.split("\n")[0]), "no counts on the verdict line");
  assert(before.includes("    https://www.one1.co.il/ — on hold (HOST_CHALLENGE): Cloudflare challenge on headless browsers since 2026-10-09 (one1)"), "held sites named in the skipped list as F did");
  const none = renderSweepReport(sweep, items, { timeZone: TZ, holds: { sites: [], events: [] } });
  assert(!none.includes("On hold") && /need attention$/.test(none.split("\n")[0]), "and with nothing held, nothing is printed");
});

check("the mailer sets the ACTION line in bold, and nothing else", () => {
  const text = renderSweepReport(sweep, items, { timeZone: TZ, skipped, holds });
  const html = buildMailBody(text);
  assert(html.includes("\n<b>ACTION: say hold x.example (Cloudflare blocked on Saturday too)</b>\n"), "the ACTION line is bold, on its own line");
  assert((html.match(/<b>/g) ?? []).length === 1, "and only it");
  assert(!buildMailBody("Nightly sweep 2026-10-17: 3 sites, 0 need attention\n  ACTION: indented is not a prefix").includes("<b>"), "only a line that starts with ACTION:");
  assert(buildMailBody("ACTION: a <b> tag").includes("<b>ACTION: a &lt;b&gt; tag</b>"), "the text inside is still escaped");
});

const ROOT = join(__dirname, "..", "..");
check("the nightly loads the block for its fleet report; closeSweep passes it on", () => {
  const src = readFileSync(join(ROOT, "worker/sweep/nightly.ts"), "utf8");
  assert((src.match(/holds: fleetNightly \? await loadHoldReport\(holdEvents\) : undefined,/g) ?? []).length === 2, "the close and the halt both carry it");
  assert(/const fleetNightly = !single && lane === "nightly";/.test(src), "on the nightly fleet run only");
  const loader = src.slice(src.indexOf("async function loadHoldReport"), src.indexOf("\n}\n", src.indexOf("async function loadHoldReport")));
  assert(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(loader), "loadHoldReport only reads");
  const common = readFileSync(join(ROOT, "worker/sweep/sweepCommon.ts"), "utf8");
  assert(/holds: args\.holds,/.test(common), "closeSweep hands it to the report");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("sweepReportHold: all assertions passed");
