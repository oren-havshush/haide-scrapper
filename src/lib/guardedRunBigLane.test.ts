// Run: npx tsx src/lib/guardedRunBigLane.test.ts
//
// Guarded runs while the big lane runs (big-lane design, item 5): a request or
// a claim is refused with code BIG_LANE_RUNNING and the time the lane ends,
// "the big lane is running until about HH:MM Asia/Jerusalem; ask again after",
// the same shape as QUIET_WINDOW. Without a big lane the gates are unchanged.

process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planGuardedRunClaim, planGuardedRunRequest } from "./guardedRun";

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

const review = { status: "REVIEW" };
const eleven = new Date("2026-10-12T20:00:00Z"); // 23:00 Jerusalem (summer)
const until = new Date("2026-10-12T22:45:00Z"); // 01:45 Jerusalem

check("a request while the big lane runs", () => {
  const g = planGuardedRunRequest(review, true, false, eleven, { until });
  assert(!g.ok && g.code === "BIG_LANE_RUNNING", `refused as BIG_LANE_RUNNING (got ${JSON.stringify(g)})`);
  assert(
    !g.ok && g.reason === "the big lane is running until about 01:45 Asia/Jerusalem; ask again after",
    `with the end time (got ${JSON.stringify(!g.ok && g.reason)})`,
  );
});

check("a claim while the big lane runs", () => {
  const g = planGuardedRunClaim(true, eleven, { until });
  assert(!g.ok && g.code === "BIG_LANE_RUNNING", `refused as BIG_LANE_RUNNING (got ${JSON.stringify(g)})`);
});

check("winter time", () => {
  const g = planGuardedRunClaim(true, new Date("2026-11-10T21:00:00Z"), { until: new Date("2026-11-10T23:45:00Z") });
  assert(!g.ok && /until about 01:45 Asia\/Jerusalem/.test(g.reason), `01:45 in winter too (got ${JSON.stringify(!g.ok && g.reason)})`);
});

check("unchanged without a big lane", () => {
  const r = planGuardedRunRequest(review, true, false, eleven, null);
  assert(!r.ok && r.code === "SWEEP_RUNNING", "another sweep running is still SWEEP_RUNNING");
  assert(planGuardedRunRequest(review, false, false, eleven, null).ok, "nothing running: allowed");
  const c = planGuardedRunClaim(true, eleven, null);
  assert(!c.ok && c.code === "SWEEP_RUNNING", "the claim too");
  const p = planGuardedRunRequest(review, true, true, eleven, { until });
  assert(!p.ok && p.code === "ALREADY_PENDING", "a pending request is still named first");
  const n = planGuardedRunRequest({ status: "ACTIVE" }, true, false, eleven, { until });
  assert(!n.ok && n.code === "NOT_REVIEW", "and a site not in REVIEW");
});

const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*$/gm, "");
check("the callers pass the running big lane's stop", () => {
  const service = strip(readFileSync(join(__dirname, "..", "services", "guardedRunService.ts"), "utf8"));
  assert(/kind: BIG_LANE_SWEEP_KIND/.test(service) && /bigLaneStopAt\(/.test(service), "the request route reads the SCRAPE_BIG sweep and its stop");
  assert(/planGuardedRunRequest\(site, activeSweep, pending, a\.now, bigLane\)/.test(service), "and passes it");
  const nightly = strip(readFileSync(join(__dirname, "..", "..", "worker", "sweep", "nightly.ts"), "utf8"));
  const claim = nightly.slice(nightly.indexOf("async function claimRequest"));
  assert(/kind: BIG_LANE_SWEEP_KIND/.test(claim) && /bigLaneStopAt\(/.test(claim), "the claim reads it too");
  assert(/planGuardedRunClaim\(activeSweep, new Date\(\), bigLane\)/.test(claim), "and passes it");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("guardedRunBigLane: all passed");
