// Run: npx tsx worker/lib/hostError.test.ts
//
// A host error on a 5xx listing (owner, 2026-10-11). razel.co.il, the
// 2026-10-11 sweep: the listing answered HTTP 503 from Microsoft-HTTPAPI/2.0
// ("Service Unavailable", IIS's own page when the application pool is down),
// .productDiv matched nothing, and the run was labelled structure_changed and
// reported as silent drift. The same URL answered 200 with 34 cards at 09:29Z.
// A listing whose main response is 5xx and that matches nothing is labelled
// host_error, with the status and reason text, and the listing load gets the
// single retry a timeout gets. A 200 page that matches nothing stays
// structure_changed; a 5xx that recovers on the retry is written normally.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LISTING_RETRY_TIMEOUT_MS, LISTING_RETRY_WAIT_MS, navigateWithRetry, serverErrorRetry } from "./navRetry";
import { HOST_ERROR, HOST_ERROR_WARNING, hostErrorLabel, hostErrorOf, newExtractGuard, onExplicitZeroMatch, zeroMatchRefusal } from "./zeroMatch";
import { needsAttention, computeCounters, renderSweepReport, type ReportItem, type ReportSweep } from "./sweepReport";
import { classifyOutcome } from "./sweepSelection";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void | Promise<void>) {
  return Promise.resolve()
    .then(body)
    .catch((err) => {
      console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
      failures++;
    });
}

type FakeResponse = { status: () => number; statusText: () => string };
const res = (status: number, text: string): FakeResponse => ({ status: () => status, statusText: () => text });

/** A listing load whose answers are given in order; records every attempt. */
function harness(answers: FakeResponse[]) {
  const calls: number[] = [];
  const slept: number[] = [];
  const logs: string[] = [];
  const go = async (t: number) => {
    calls.push(t);
    return answers[Math.min(calls.length - 1, answers.length - 1)];
  };
  const run = () =>
    navigateWithRetry(go, {
      firstTimeoutMs: 30_000,
      sleep: async (ms) => {
        slept.push(ms);
      },
      log: (m) => logs.push(m),
      retryResult: serverErrorRetry,
    });
  return { calls, slept, logs, run };
}

const SWEEP: ReportSweep = {
  id: "sw",
  kind: "SCRAPE",
  status: "COMPLETED",
  trigger: "timer",
  startedAt: new Date("2026-10-10T23:01:00Z"),
  finishedAt: new Date("2026-10-11T00:57:06Z"),
  selectedCount: 3,
  haltReason: null,
};
function item(over: Partial<ReportItem>): ReportItem {
  return {
    siteId: "s",
    siteUrl: "https://s.test",
    phase: "scrape",
    outcome: "success",
    failureCategory: null,
    jobsBefore: 10,
    jobsAfter: 10,
    newestJobAt: new Date("2026-10-10T23:30:00Z"),
    siteStatus: "ACTIVE",
    wouldDemoteTo: null,
    wouldPromoteTo: null,
    ...over,
  };
}

(async () => {
  await check("razel's night: 503, one retry, still 503: host_error with 29 kept", async () => {
    const h = harness([res(503, "Service Unavailable"), res(503, "Service Unavailable")]);
    const r = await h.run();
    assert(h.calls.length === 2, `one retry attempted (got ${h.calls.length} attempt(s))`);
    assert(h.calls[1] === LISTING_RETRY_TIMEOUT_MS, `the retry has the timeout retry's limit (got ${h.calls[1]})`);
    assert(h.slept[0] === LISTING_RETRY_WAIT_MS, `and waits as the timeout retry does (got ${h.slept[0]})`);
    assert(h.logs.some((l) => /HTTP 503/.test(l)), `the retry is logged with the status (got ${JSON.stringify(h.logs)})`);

    const guard = newExtractGuard(true);
    guard.hostError = hostErrorOf(r.status(), r.statusText());
    assert(guard.hostError === "HTTP 503 (Service Unavailable)", `the status and reason are recorded (got ${guard.hostError})`);
    onExplicitZeroMatch(guard, "body .productDiv", "Service Unavailable");
    const refusal = zeroMatchRefusal(guard, 0);
    assert(refusal?.failureCategory === HOST_ERROR, `labelled host_error, not structure_changed (got ${refusal?.failureCategory})`);
    assert(HOST_ERROR === "host_error", "the category is host_error");
    assert(refusal?.runStatus === "COMPLETED", "a scheduled refusal closes COMPLETED");
    assert(/^listing answered HTTP 503 \(Service Unavailable\)/.test(refusal?.error ?? ""), `the error leads with the status (got ${refusal?.error})`);
    assert(
      (refusal?.warnings ?? []).includes(`${HOST_ERROR_WARNING}: HTTP 503 (Service Unavailable)`),
      `the warning carries the status (got ${JSON.stringify(refusal?.warnings)})`,
    );
    assert((refusal?.warnings ?? []).includes("item_selector_zero_match: body .productDiv"), "and the zero match");

    const razel = item({
      siteId: "rz",
      siteUrl: "http://www.razel.test/html5/FILTERS.TAF?did=8843",
      outcome: classifyOutcome({ status: "COMPLETED", failureCategory: refusal?.failureCategory ?? null }),
      failureCategory: refusal?.failureCategory ?? null,
      jobsBefore: 29,
      jobsAfter: 29,
      warnings: refusal?.warnings,
    });
    assert(razel.outcome === "soft_failure", `a host error is a soft failure (got ${razel.outcome})`);
    const lines = needsAttention(SWEEP, [razel, item({ siteId: "a" }), item({ siteId: "b" })]);
    const why = lines.find((l) => /razel/.test(l.siteUrl))?.why ?? "";
    assert(
      why === "listing answered HTTP 503 (Service Unavailable) — nothing written, 29 listing(s) kept",
      `the Needs-attention line (got "${why}")`,
    );
    const c = computeCounters(SWEEP, [razel]);
    assert(c.silentDrift === 0, `not silent drift (got ${c.silentDrift})`);
    const text = renderSweepReport(SWEEP, [razel, item({ siteId: "a" }), item({ siteId: "b" })], { timeZone: "Asia/Jerusalem" });
    assert(/\n\s+1 {2}host error \(the listing answered 5xx\)/.test(text), `the Outcomes block counts it\n${text}`);
  });

  await check("a 200 page with 0 matches stays structure_changed", async () => {
    const h = harness([res(200, "OK")]);
    const r = await h.run();
    assert(h.calls.length === 1, `a 200 is not retried (got ${h.calls.length})`);
    const guard = newExtractGuard(true);
    guard.hostError = hostErrorOf(r.status(), r.statusText());
    assert(guard.hostError === null, "a 200 records no host error");
    onExplicitZeroMatch(guard, "body .productDiv", "| razel");
    assert(zeroMatchRefusal(guard, 0)?.failureCategory === "structure_changed", "structure_changed as before");
    assert(hostErrorOf(404, "Not Found") === null, "a 4xx is not a host error");
  });

  await check("a 5xx that is a bot challenge is not retried, and stays blocked", async () => {
    const cf = { status: () => 503, statusText: () => "Service Unavailable", url: () => "https://x.test/jobs", headers: () => ({ server: "cloudflare", "cf-mitigated": "challenge" }) };
    assert(serverErrorRetry(cf) === null, "Cloudflare's 503 challenge is not retried");
    const guard = newExtractGuard(true);
    guard.challenge = "Cloudflare challenge (cf-mitigated: challenge)";
    guard.hostError = hostErrorOf(503, "Service Unavailable");
    onExplicitZeroMatch(guard, "body .job", "x");
    assert(zeroMatchRefusal(guard, 0)?.failureCategory === "blocked", "the challenge outranks the host error");
  });

  await check("a 5xx that recovers on the retry is written normally", async () => {
    const h = harness([res(503, "Service Unavailable"), res(200, "OK")]);
    const r = await h.run();
    assert(h.calls.length === 2 && r.status() === 200, "the retry's 200 is what the run gets");
    const guard = newExtractGuard(true);
    guard.hostError = hostErrorOf(r.status(), r.statusText());
    assert(guard.hostError === null, "no host error recorded");
    assert(zeroMatchRefusal(guard, 29) === null, "29 rows: no refusal, written");
  });

  await check("the empty path is labelled host_error after a 5xx, and only then", () => {
    const guard = newExtractGuard(true);
    assert(hostErrorLabel("empty_results", guard) === "empty_results", "no 5xx: empty_results");
    guard.hostError = "HTTP 502 (Bad Gateway)";
    assert(hostErrorLabel("empty_results", guard) === HOST_ERROR, "after a 5xx: host_error");
    assert(hostErrorLabel("timeout", guard) === "timeout", "other categories untouched");
    assert(hostErrorOf(500, "") === "HTTP 500", "no reason text: the status alone");
  });

  await check("scrape.ts wires it", () => {
    const scrape = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
    const goto = scrape.slice(scrape.indexOf("async function gotoForgiving("), scrape.indexOf("async function settleSiteGroundIpc("));
    assert(/retryResult: serverErrorRetry/.test(goto), "the listing load retries a 5xx once");
    assert(/hostError = hostErrorOf\(/.test(goto), "and records a 5xx that stayed on the guard");
    const empty = scrape.slice(scrape.indexOf("// Handle empty results (AC #5)"), scrape.indexOf("// Handle empty results (AC #5)") + 1500);
    assert(/hostErrorLabel\(/.test(empty), "the empty path reads it");
    const nat = readFileSync(join(__dirname, "../../src/components/dashboard/NeedsAttentionTable.tsx"), "utf8");
    assert(/host_error:/.test(nat), "the dashboard names the category");
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("hostError: a 5xx listing is a host error, retried once; a 200 with no match stays structure_changed");
})();
