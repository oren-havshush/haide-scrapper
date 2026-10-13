// Run: npx tsx worker/lib/autoHold.test.ts
//
// The automatic hold and pause, as the nightly applies them (G3, owner
// 2026-10-13): the night's plan (worker/lib/holdRule.ts planAutoHolds), what
// each decision writes (autoHoldWrite), the Saturday retry in the selection,
// and where nightly.ts runs it. The lift of a Cloudflare pause is the one
// automatic clear; nothing but the route's release clears a hold otherwise.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { challengeWaitRecord } from "./challengeWait";
import { autoHoldWrite, planAutoHolds, type AutoHoldInput } from "./holdRule";
import { selectSitesForSweep, type SelectableSite } from "./sweepSelection";
import { selectDuePolicyReviews, type PolicyCandidate } from "../../src/lib/policySelection";

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

const SG_BLOCKED = { outcome: "soft_failure", failureCategory: "blocked", warnings: ["blocked_challenge: SiteGround challenge (sg-captcha: challenge)", challengeWaitRecord("captcha", 11_000)] };
const CF_BLOCKED = { outcome: "soft_failure", failureCategory: "blocked", warnings: ["blocked_challenge: Cloudflare challenge (cf-mitigated: challenge)"] };
const WROTE = { outcome: "success", failureCategory: null, warnings: [] };
const nights = ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"];
const input = (over: Partial<AutoHoldInput>): AutoHoldInput => ({ siteId: "s1", siteUrl: "https://s1.example/", state: null, tonight: WROTE, history: [], ...over });

check("planAutoHolds: hold, pause, lift, and a re-run of tonight", () => {
  const wk = { night: "2026-10-14", timerNights: nights, saturday: false };
  const hold = planAutoHolds([input({ tonight: SG_BLOCKED, history: [{ night: "2026-10-12", item: SG_BLOCKED }, { night: "2026-10-13", item: SG_BLOCKED }] })], wk);
  assert(hold.length === 1 && hold[0].decision.action === "hold", `the third SiteGround night holds (got ${JSON.stringify(hold)})`);
  const two = planAutoHolds([input({ tonight: SG_BLOCKED, history: [{ night: "2026-10-13", item: SG_BLOCKED }, { night: "2026-10-14", item: SG_BLOCKED }] })], wk);
  assert(two.length === 0, `an earlier item of tonight's date is replaced by tonight's, not counted twice (got ${JSON.stringify(two)})`);
  const pause = planAutoHolds([input({ tonight: CF_BLOCKED })], wk);
  assert(pause.length === 1 && pause[0].decision.action === "pause", `a Cloudflare night pauses (got ${JSON.stringify(pause)})`);
  const sat = { night: "2026-10-17", timerNights: nights, saturday: true };
  const lift = planAutoHolds([input({ state: "CHALLENGE_RETRY_SATURDAY", tonight: WROTE })], sat);
  assert(lift.length === 1 && lift[0].decision.action === "lift_pause", `the Saturday retry that wrote rows lifts the pause (got ${JSON.stringify(lift)})`);
  const none = planAutoHolds([input({ state: "HOST_CHALLENGE", tonight: WROTE })], sat);
  assert(none.length === 0, `a HOST_CHALLENGE hold is never released by a run (got ${JSON.stringify(none)})`);
});

const HOLD_COLUMNS = ["sweepHold", "sweepHoldAt", "sweepHoldNote", "sweepHoldBy", "sweepHoldProbeAt", "sweepHoldProbeResult"].sort().join();
check("autoHoldWrite writes the hold columns only, each scoped by the hold the site must still have", () => {
  const now = new Date("2026-10-14T23:30:00Z");
  const hold = autoHoldWrite({ action: "hold", note: "auto: SiteGround challenge (interactive captcha) on 3 nights, 2026-10-12..2026-10-14" }, now);
  assert(hold !== null && hold.onlyIf === null && hold.data.sweepHold === "HOST_CHALLENGE" && hold.data.sweepHoldBy === "auto", `a hold lands only on an unheld site, set by "auto" (got ${JSON.stringify(hold)})`);
  assert(hold !== null && Object.keys(hold.data).sort().join() === HOLD_COLUMNS, `a hold writes the six hold columns and nothing else (got ${hold && Object.keys(hold.data).join()})`);
  const pause = autoHoldWrite({ action: "pause", note: "auto: Cloudflare challenge on 2026-10-14; retry Saturday night" }, now);
  assert(pause !== null && pause.onlyIf === null && pause.data.sweepHold === "CHALLENGE_RETRY_SATURDAY" && pause.data.sweepHoldBy === "auto", `a pause (got ${JSON.stringify(pause)})`);
  const lift = autoHoldWrite({ action: "lift_pause" }, now);
  assert(lift !== null && lift.onlyIf === "CHALLENGE_RETRY_SATURDAY" && Object.values(lift.data).every((v) => v === null), `a lift clears the six, only on a site still paused (got ${JSON.stringify(lift)})`);
  assert(lift !== null && Object.keys(lift.data).sort().join() === HOLD_COLUMNS, "and nothing else");
  assert(autoHoldWrite({ action: "pause_stays", blockedAgain: true, why: "Cloudflare blocked on Saturday too" }, now) === null, "a pause that stays writes nothing");
});

check("the Saturday-night run retries a paused site; nothing else selects a held one", () => {
  const now = new Date("2026-10-16T23:01:00Z");
  const mappings = { title: { selector: ".t" }, location: { selector: ".l" } };
  const site = (id: string, hold: string | null, lastSuccessAt: Date | null = null): SelectableSite =>
    ({ id, siteUrl: `https://${id}.example/`, status: "ACTIVE", fieldMappings: mappings, lastSuccessAt, lastAttemptAt: null, sweepHold: hold, sweepHoldNote: null }) as SelectableSite;
  // Paused, and scraped by hand two hours ago: still retried on Saturday.
  const sites = [site("paused", "CHALLENGE_RETRY_SATURDAY", new Date("2026-10-16T21:00:00Z")), site("held", "HOST_CHALLENGE")];
  const saturday = selectSitesForSweep(sites, { now, retryPaused: true });
  assert(saturday.selected.map((s) => s.id).join() === "paused", `Saturday selects the paused site, past the fresh window, and not the held one (got ${saturday.selected.map((s) => s.id).join()})`);
  const weekday = selectSitesForSweep(sites, { now });
  assert(weekday.selected.length === 0 && weekday.excluded.every((e) => e.kind === "hold"), `a weekday night selects neither (got ${weekday.selected.map((s) => s.id).join()})`);
  const cand = { id: "paused", siteUrl: "https://paused.example/", status: "ACTIVE", scrapingPolicyStatus: "RESTRICTED", scrapingPolicyCheckedAt: null, companyProfileAt: new Date("2026-01-01"), sweepHold: "CHALLENGE_RETRY_SATURDAY" } as PolicyCandidate;
  const policy = selectDuePolicyReviews([cand], { now, recheckIntervalDays: 30, statuses: ["ACTIVE", "REVIEW"], requireCompanyProfile: true, excludeHeld: true } as Parameters<typeof selectDuePolicyReviews>[1]);
  assert(policy.selected.length === 0, "the policy sweep skips a paused site, Saturday included");
});

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

check("nightly.ts: after the items, before the report, timer nights only, hold columns only", () => {
  const src = read("worker/sweep/nightly.ts");
  const start = src.indexOf("async function applyAutoHolds");
  assert(start > 0, "applyAutoHolds exists");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const writes = body.match(/prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g) ?? [];
  assert(writes.length === 1 && writes[0] === "prisma.site.updateMany(", `its one write is prisma.site.updateMany (got ${writes.join(", ")})`);
  assert(/updateMany\(\{ where: \{ id: e\.siteId, sweepHold: write\.onlyIf \}, data: write\.data \}\)/.test(body), "scoped by the hold the site must still have, with autoHoldWrite's data");
  assert(!/status:|fieldMappings|prisma\.job\b/.test(body), "it touches no status, config or job");

  const run = src.slice(src.indexOf("async function realRun"));
  assert(/const timerNight = trigger === "timer" && !single && lane === "nightly";/.test(run), "timerNight: the timer's nightly fleet run only");
  const calls = run.match(/const holdEvents = timerNight \? await applyAutoHolds\(sweep\.id, sweep\.startedAt, results\) : \[\];/g) ?? [];
  const bare = run.match(/applyAutoHolds\(/g) ?? [];
  assert(calls.length === 2 && bare.length === 2, `called twice (halt, close), each behind timerNight (got ${calls.length} guarded of ${bare.length})`);
  const loop = run.indexOf("for (const site of queue)");
  const lastCall = run.lastIndexOf("applyAutoHolds(");
  const close = run.indexOf("const reportText = await closeSweep(");
  assert(loop > 0 && lastCall > loop && lastCall < close, "the close-out call comes after the loop and before the report");
  const halt = run.indexOf("const haltedText = await closeSweep(");
  const firstCall = run.indexOf("applyAutoHolds(");
  assert(firstCall > 0 && firstCall < halt, "the halt path applies it before its report too");
  assert(/const saturdayNight = timerNight && isSaturdayRun\(now\);/.test(run) && /retryPaused: saturdayNight,/.test(run),"the selection retries paused sites on the Saturday-night timer run only");
});

check("no path clears a hold but the route's release and the pause's lift", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, name);
      if (name === "node_modules" || name === "generated" || name.startsWith(".")) continue;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(rel);
    }
  };
  for (const d of ["src", "worker", "scripts"]) walk(d);
  const clearing = files.filter((f) => /sweepHold: null/.test(read(f))).map((f) => relative(ROOT, join(ROOT, f)).split("\\").join("/")).sort();
  assert(clearing.join() === "src/lib/sweepHold.ts,worker/lib/holdRule.ts", `only these two write sweepHold: null (got ${clearing.join()})`);
  const rule = read("worker/lib/holdRule.ts");
  const clears = rule.match(/sweepHold: null/g) ?? [];
  assert(clears.length === 1, `holdRule.ts clears once (got ${clears.length})`);
  const at = rule.indexOf("sweepHold: null");
  const caseAt = rule.lastIndexOf("case ", at);
  assert(rule.slice(caseAt, at).startsWith(`case "lift_pause":`) && /onlyIf: "CHALLENGE_RETRY_SATURDAY"/.test(rule.slice(caseAt, at)), "and only in the lift, scoped to a site still paused");
  const lib = read("src/lib/sweepHold.ts");
  assert(/if \(body\.hold === null\) \{\s*return \{ sweepHold: null,/.test(lib), "sweepHold.ts clears only on the route's { hold: null }");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("autoHold: all assertions passed");
