// Run: npx tsx worker/lib/bigLane.test.ts
//
// The big lane (big-lane design, item 1): a 22:00-01:45 Asia/Jerusalem sweep
// of the sites with lane "big", which the nightly excludes. The clock
// arithmetic on a UTC host across both DST changes, the fit check at its
// edges, the Friday-night full pass, the hard stop as the run's own deadline,
// selection both ways, the command line, and the timer files.

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BIG_LANE_SWEEP_KIND,
  BIG_LANE_WINDOW_MINUTES,
  CUT_OFF,
  bigLaneDetailMode,
  bigLaneStopAt,
  cutOffMessage,
  expectedMinutes,
  fitsBeforeStop,
  insideBigLaneWindow,
  noFitReason,
  readStopAt,
  runDeadline,
} from "./bigLane";
import { classifyOutcome, selectSitesForSweep, type SelectableSite } from "./sweepSelection";
import { parseNightlyArgs, resolveDetailMode } from "./nightlyArgs";
import { buildScrapeJobRow } from "../../src/lib/scrapeJobRow";
import { renderSweepReport } from "./sweepReport";

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
const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const at = (s: string) => new Date(s);

check("the stop is the next 01:45 Jerusalem", () => {
  // Summer (UTC+3): 22:00 Monday -> 01:45 Tuesday.
  assert(iso(bigLaneStopAt(at("2026-10-12T19:00:00Z"))) === "2026-10-12T22:45:00Z", "summer: 22:00 -> 01:45 = 22:45Z");
  // The night the clocks go back (02:00 -> 01:00 on 2026-10-25): 01:45 happens
  // twice, at 22:45Z and 23:45Z. The lane stops at the first.
  assert(iso(bigLaneStopAt(at("2026-10-24T19:00:00Z"))) === "2026-10-24T22:45:00Z", "the night of 10-25: the first 01:45");
  // Winter (UTC+2).
  assert(iso(bigLaneStopAt(at("2026-11-10T20:00:00Z"))) === "2026-11-10T23:45:00Z", "winter: 22:00 -> 01:45 = 23:45Z");
  // The night the clocks go forward (02:00 on 2027-03-26): 01:45 is still winter time.
  assert(iso(bigLaneStopAt(at("2027-03-25T20:00:00Z"))) === "2027-03-25T23:45:00Z", "the night of 2027-03-26: 01:45 before the change");
  // A start after midnight stops the same night.
  assert(iso(bigLaneStopAt(at("2026-10-16T21:30:00Z"))) === "2026-10-16T22:45:00Z", "00:30 -> 01:45 the same night");
});

check("the window's arithmetic", () => {
  const start = at("2026-10-12T19:00:00Z");
  const minutes = (bigLaneStopAt(start).getTime() - start.getTime()) / 60_000;
  assert(minutes === BIG_LANE_WINDOW_MINUTES && minutes === 225, `22:00 to 01:45 is 225 minutes (got ${minutes})`);
  // The nightly starts at 02:00: the lane's stop is before it, with the
  // service's backstop (TimeoutStartSec) and its 60 s random delay included.
  const service = readFileSync(join(__dirname, "..", "..", "deploy", "systemd", "haide-sweep-big.service"), "utf8");
  const backstop = Number(/TimeoutStartSec=(\d+)min/.exec(service)?.[1]);
  assert(backstop > 0 && 22 * 60 + backstop + 1 < 26 * 60, `the backstop ends before 02:00 (TimeoutStartSec=${backstop}min)`);
  assert(backstop >= 225 + 3, "and covers the window plus the 3-minute close");
  const nightly = readFileSync(join(__dirname, "..", "..", "deploy", "systemd", "haide-sweep-scrape.timer"), "utf8");
  assert(/^OnCalendar=\*-\*-\* 02:00:00 Asia\/Jerusalem$/m.test(nightly), "the nightly still starts at 02:00");
});

check("inside the window", () => {
  assert(!insideBigLaneWindow(at("2026-10-12T18:59:00Z")), "21:59 is outside");
  assert(insideBigLaneWindow(at("2026-10-12T19:00:00Z")), "22:00 is inside");
  assert(insideBigLaneWindow(at("2026-10-12T22:44:00Z")), "01:44 is inside");
  assert(!insideBigLaneWindow(at("2026-10-12T22:45:00Z")), "01:45 is outside");
  assert(!insideBigLaneWindow(at("2026-10-12T09:00:00Z")), "noon is outside");
});

check("the Friday-night full pass", () => {
  assert(bigLaneDetailMode(at("2026-10-16T19:00:00Z")) === "full", "Friday 22:00 is full");
  assert(bigLaneDetailMode(at("2026-10-16T21:30:00Z")) === "full", "Saturday 00:30, the same window, is full");
  assert(bigLaneDetailMode(at("2026-10-15T19:00:00Z")) === "incremental", "Thursday 22:00 is incremental");
  assert(bigLaneDetailMode(at("2026-10-17T19:00:00Z")) === "incremental", "Saturday 22:00 is incremental");
});

check("the fit check", () => {
  assert(expectedMinutes([10, 50, 30], {}) === 30, "the median of the last three");
  assert(expectedMinutes([5, 6, 7, 100], {}) === 6, "only the last three count");
  assert(expectedMinutes([40, 60], {}) === 50, "two runs: their mean");
  assert(expectedMinutes([], { timeBudgetMinutes: 180 }) === 180, "no history: the site's budget");
  assert(expectedMinutes([], {}) === 15, "no history, no budget: 15");
  const stop = bigLaneStopAt(at("2026-10-12T19:00:00Z"));
  assert(!fitsBeforeStop(at("2026-10-12T22:44:00Z"), 2, stop), "01:44 with 2 minutes expected is refused");
  assert(fitsBeforeStop(at("2026-10-12T20:00:00Z"), 120, stop), "23:00 with 120 is allowed");
  assert(fitsBeforeStop(at("2026-10-12T22:15:00Z"), 30, stop), "ending exactly at 01:45 is allowed");
  assert(noFitReason(30) === "would not finish before 01:45 (expected 30 min)", "the skip line");
});

check("the hard stop is the run's own deadline", () => {
  const stopAt = at("2026-10-12T22:45:00Z");
  const scheduled = { scrapeRunId: "r", scheduled: true, stopAt: stopAt.toISOString() };
  assert(readStopAt(scheduled)?.getTime() === stopAt.getTime(), "a scheduled payload carries it");
  assert(readStopAt({ scrapeRunId: "r", stopAt: stopAt.toISOString() }) === null, "a manual payload never does");
  assert(readStopAt({ scheduled: true, stopAt: "soon" }) === null, "an unreadable one is no stop");
  assert(readStopAt(null) === null, "no payload, no stop");
  const start = at("2026-10-12T22:00:00Z").getTime();
  const d1 = runDeadline(start, 180 * 60_000, stopAt);
  assert(d1.ms === 45 * 60_000 && d1.cutOff, "the stop is sooner than the budget: it binds");
  const d2 = runDeadline(start, 30 * 60_000, stopAt);
  assert(d2.ms === 30 * 60_000 && !d2.cutOff, "the budget is sooner: it binds");
  const d3 = runDeadline(start, 30 * 60_000, null);
  assert(d3.ms === 30 * 60_000 && !d3.cutOff, "no stop: the budget");
  const d4 = runDeadline(stopAt.getTime() + 60_000, 30 * 60_000, stopAt);
  assert(d4.ms === 0 && d4.cutOff, "already past the stop: at once");
  assert(cutOffMessage(44.6) === "cut off at 01:45 after 45 min — nothing written, previous listings kept", "the cut-off line");
  assert(classifyOutcome({ status: "COMPLETED", failureCategory: CUT_OFF }) !== "hard_failure", "a cut-off is never a hard failure");
  assert(classifyOutcome({ status: "FAILED", failureCategory: CUT_OFF }) !== "hard_failure", "nor when FAILED");
});

check("the job row carries the stop only when scheduled", () => {
  const stopAt = at("2026-10-12T22:45:00Z");
  const sched = buildScrapeJobRow({ siteId: "s", scrapeRunId: "r", scheduled: true, stopAt }).payload as Record<string, unknown>;
  assert(sched.stopAt === "2026-10-12T22:45:00.000Z", `scheduled: stopAt written (got ${JSON.stringify(sched.stopAt)})`);
  const manual = buildScrapeJobRow({ siteId: "s", scrapeRunId: "r", stopAt }).payload as Record<string, unknown>;
  assert(!("stopAt" in manual), "manual: never");
});

const site = (id: string, lane?: string): SelectableSite => ({
  id,
  siteUrl: `https://${id}.example/`,
  status: "ACTIVE",
  fieldMappings: { title: { selector: "h2" }, _meta: lane ? { lane } : {} },
  lastSuccessAt: null,
  lastAttemptAt: null,
});

check("selection, both lanes", () => {
  const fleet = [site("a"), site("maof", "big"), site("b")];
  const now = at("2026-10-12T23:00:00Z");
  const nightly = selectSitesForSweep(fleet, { now });
  assert(nightly.selected.map((s) => s.id).join(",") === "a,b", `the nightly leaves the big site out (got ${nightly.selected.map((s) => s.id)})`);
  const ex = nightly.excluded.find((e) => e.site.id === "maof");
  assert(ex?.kind === "big_lane" && /big lane/.test(ex.reason), `with the reason "big lane" (got ${JSON.stringify(ex && { kind: ex.kind, reason: ex.reason })})`);
  const big = selectSitesForSweep(fleet, { now, lane: "big" });
  assert(big.selected.map((s) => s.id).join(",") === "maof", `the big lane selects only it (got ${big.selected.map((s) => s.id)})`);
  assert(big.excluded.length === 0, "and does not list the nightly's sites as skipped");
  const fresh = { ...site("maof", "big"), lastSuccessAt: at("2026-10-12T20:00:00Z") };
  assert(selectSitesForSweep([fresh], { now, lane: "big" }).selected.length === 0, "the big lane keeps the fresh window");
});

check("the nightly report counts the big-lane skips on one line", () => {
  const text = renderSweepReport(
    { id: "w", kind: "SCRAPE", status: "COMPLETED", trigger: "timer", startedAt: at("2026-10-12T23:00:00Z"), finishedAt: at("2026-10-13T03:00:00Z"), selectedCount: 0, haltReason: null },
    [],
    {
      timeZone: "Asia/Jerusalem",
      skipped: [
        { siteUrl: "https://maof.example/", reason: "big lane (22:00-01:45)", kind: "big_lane" },
        { siteUrl: "https://x.example/", reason: "no usable fieldMappings (would fail immediately)" },
      ],
    },
  );
  assert(/1 in the big lane \(22:00-01:45\)/.test(text), "one count line");
  assert(!/maof\.example/.test(text), "the big-lane site is not named among the skips");
  assert(/x\.example/.test(text), "the other skip is");
});

check("the command line", () => {
  const big = parseNightlyArgs(["--now", "--lane", "big"]);
  assert(big.kind === "fleet" && big.lane === "big", `--now --lane big (got ${JSON.stringify(big)})`);
  const plain = parseNightlyArgs(["--now"]);
  assert(plain.kind === "fleet" && plain.lane === "nightly", "--now is the nightly");
  const dry = parseNightlyArgs(["--dry-run", "--lane", "big"]);
  assert(dry.kind === "dry-run" && dry.lane === "big", "--dry-run --lane big");
  let threw = 0;
  for (const argv of [["--now", "--lane", "small"], ["--now", "--lane"], ["--site", "x", "--now", "--lane", "big"], ["--claim-request", "--lane", "big"]]) {
    try {
      parseNightlyArgs(argv);
    } catch {
      threw++;
    }
  }
  assert(threw === 4, `a bad lane, a bare --lane, --lane with --site or --claim-request are refused (${threw} of 4)`);
  assert(resolveDetailMode(big, at("2026-10-16T19:00:00Z")) === "full", "the big lane on Friday 22:00 is full");
  assert(resolveDetailMode(big, at("2026-10-15T19:00:00Z")) === "incremental", "and Thursday 22:00 incremental");
  assert(resolveDetailMode(plain, at("2026-10-16T19:00:00Z")) === "incremental", "the nightly at Friday 22:00 is not its Saturday pass");
});

const read = (...p: string[]) => readFileSync(join(__dirname, "..", "..", ...p), "utf8");
const strip = (s: string) => s.replace(/^\s*(\/\/|#)[^\n]*$/gm, "");

check("the timer files", () => {
  const timer = strip(read("deploy", "systemd", "haide-sweep-big.timer"));
  assert(/^OnCalendar=\*-\*-\* 22:00:00 Asia\/Jerusalem$/m.test(timer), "OnCalendar 22:00 Asia/Jerusalem");
  assert(!/^Timezone=/m.test(timer), "no Timezone= key");
  assert(/^Persistent=false$/m.test(timer), "Persistent=false");
  const service = strip(read("deploy", "systemd", "haide-sweep-big.service"));
  assert(/--name haide-sweep-big /.test(service), "the container is haide-sweep-big");
  assert(/nightly\.ts --now --lane big --trigger timer/.test(service), "it runs --now --lane big");
  assert(/docker rm -f haide-sweep-big/.test(service), "and removes its container after");
  for (const f of ["haide-sweep-big.timer", "haide-sweep-big.service"]) {
    assert(!read("deploy", "systemd", f).includes("\r"), `${f} has LF line endings`);
  }
});

check("deploy.sh", () => {
  const deploy = read("deploy.sh");
  assert(/docker ps -q -f name=haide-sweep-/.test(deploy) && "haide-sweep-big".startsWith("haide-sweep-"), "the running-sweep refusal covers haide-sweep-big");
  assert(/for t in haide-sweep-scrape\.timer haide-sweep-policy\.timer haide-sweep-claim\.timer haide-sweep-big\.timer; do/.test(deploy), "four is-enabled lines");
  assert(!/systemctl enable/.test(strip(deploy)), "deploy.sh enables nothing");
});

const nightlySrc = strip(read("worker", "sweep", "nightly.ts"));
check("the driver", () => {
  assert(/const sweepKind = lane === "big" \? BIG_LANE_SWEEP_KIND : "SCRAPE";/.test(nightlySrc), "a big-lane sweep row is SCRAPE_BIG");
  const realRunSrc = nightlySrc.slice(nightlySrc.indexOf("async function realRun"), nightlySrc.indexOf("async function dryRunDetails"));
  assert(!/kind: "SCRAPE"/.test(realRunSrc) && (realRunSrc.match(/kind: sweepKind,/g) ?? []).length === 5, "the row and all four closes use it");
  assert(BIG_LANE_SWEEP_KIND === "SCRAPE_BIG", "SCRAPE_BIG");
  assert(/insideBigLaneWindow\(now\)/.test(nightlySrc), "it refuses to start outside the window");
  assert(/selectSitesForSweep\([\s\S]{0,200}lane,/.test(nightlySrc), "selection by lane");
  assert(/fitsBeforeStop\(new Date\(\), expected, stopAt\)/.test(nightlySrc), "the fit check before each site");
  assert(/noFitReason\(expected\)/.test(nightlySrc), "reported when it does not fit");
  assert(/createScrapeRun\(site\.id, \{ scheduled: true, detailMode, stopAt \}\)/.test(nightlySrc), "the stop rides in the scheduled payload");
  assert(/stopAt \? Math\.min\(waitMinutes \* 60_000, stopAt\.getTime\(\) - Date\.now\(\) \+ BIG_LANE_CLOSE_MARGIN_MS\)/.test(nightlySrc), "the driver waits no later than the stop plus the close");
});

const scrapeSrc = strip(read("worker", "jobs", "scrape.ts"));
check("the scrape's deadline", () => {
  assert(/stopAt:\s*readStopAt\(job\.payload\)/.test(scrapeSrc), "handleScrapeJob reads the stop from the payload");
  const timer = scrapeSrc.slice(scrapeSrc.indexOf("function createTimeoutPromise"), scrapeSrc.indexOf("async function skipSiteForApplyLogin"));
  assert(/runDeadline\(startedMs, runMode\.limits\.timeoutMs, runMode\.stopAt\)/.test(timer), "the timer fires at the sooner of budget and stop");
  assert(/failureCategory: deadline\.cutOff \? CUT_OFF : "timeout"/.test(timer), "a cut-off closes as cut_off");
  assert(/cutOffMessage\(/.test(timer), "with the cut-off line");
  assert(!/prisma\.job\./.test(timer), "and the deadline path never touches a Job row");
  assert(/listingBudgetExhausted\(scrapeStartedAt, Date\.now\(\), runMode\.deadlineMs\)/.test(scrapeSrc), "the listing budget is the same deadline");
});

const commonSrc = strip(read("worker", "sweep", "sweepCommon.ts"));
check("the big lane's report is stored, not emailed (its block goes in the morning email)", () => {
  assert(/export type SweepKind = "SCRAPE" \| "POLICY" \| "SCRAPE_BIG";/.test(commonSrc), "SweepKind has SCRAPE_BIG");
  assert(/if \(args\.kind === BIG_LANE_SWEEP_KIND\) \{\s*emailStatus = "skipped: big lane/.test(commonSrc), "closeSweep does not email it");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("bigLane: all passed");
