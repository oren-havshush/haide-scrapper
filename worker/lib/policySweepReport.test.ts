// Run: npx tsx worker/lib/policySweepReport.test.ts
//
// End to end, without a database: driver results -> ReportItems ->
// computeCounters and renderSweepReport -> the verdict line and the Needs
// attention section.
//
// Written for a gap that no unit test could see: the verdict line counted
// `newly_restricted` while needsAttention had no rule for it, so a stored report
// could read "1 newly RESTRICTED" over "Needs attention (0) nothing". Each piece
// was tested; the join between them was not.

import {
  decidePolicyOutcome,
  toPolicyItemRow,
  toPolicyReportItem,
  type PolicyJobEnd,
  type PolicySiteResult,
} from "./policyOutcome";
import {
  computeCounters,
  needsAttention,
  renderSweepReport,
  verdictLine,
  type ReportSweep,
} from "./sweepReport";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const TZ = "Asia/Jerusalem";
const STARTED = new Date("2026-09-10T03:00:00Z"); // 06:00 in Jerusalem

/** What the driver produces for one site, through the driver's own decision. */
function driverResult(
  url: string,
  jobEnd: PolicyJobEnd,
  before: string,
  after: string,
  siteStatus = "ACTIVE",
): PolicySiteResult {
  return {
    siteId: url.replace(/\W/g, ""),
    siteUrl: url,
    siteStatus,
    policyStatusBefore: before,
    policyStatusAfter: after,
    outcome: decidePolicyOutcome({ jobEnd, before, after }),
    defect: null,
    startedAt: STARTED,
    finishedAt: new Date(STARTED.getTime() + 60_000),
  };
}

function policySweep(over: Partial<ReportSweep> = {}): ReportSweep {
  return {
    id: "pol1",
    kind: "POLICY",
    status: "COMPLETED",
    trigger: "timer",
    startedAt: STARTED,
    finishedAt: new Date(STARTED.getTime() + 10 * 60_000),
    selectedCount: 5,
    haltReason: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// One transition to RESTRICTED, end to end
// ---------------------------------------------------------------------------

{
  const results = [
    driverResult("https://fine.test", "COMPLETED", "NO_EXPLICIT_RESTRICTION", "NO_EXPLICIT_RESTRICTION"),
    driverResult("https://turned.test", "COMPLETED", "NO_EXPLICIT_RESTRICTION", "RESTRICTED"),
    driverResult("https://already.test", "COMPLETED", "RESTRICTED", "RESTRICTED"),
    driverResult("https://unreadable.test", "COMPLETED", "NOT_CHECKED", "CHECK_FAILED"),
    driverResult("https://slow.test", "TIMED_OUT", "POLICY_NOT_FOUND", "POLICY_NOT_FOUND", "REVIEW"),
  ];
  const items = results.map(toPolicyReportItem);
  const sweep = policySweep();

  const text = renderSweepReport(sweep, items, { timeZone: TZ });
  const verdict = text.split("\n")[0];

  // "checked" is a status established — success and newly_restricted. The
  // CHECK_FAILED site completed its job but established nothing, so it is one
  // of the 2 failed, with the timeout, and failed is on the line because it is
  // non-zero.
  assert(
    verdict === "Policy sweep 2026-09-10: 3 checked, 2 failed, 1 newly RESTRICTED",
    `the verdict counts statuses established, the failures, and the one transition (got "${verdict}")`,
  );
  assert(
    verdict === verdictLine(sweep, items, { timeZone: TZ }),
    "and it is the same line verdictLine gives",
  );

  const attentionBlock = text.slice(text.indexOf("Needs attention"), text.indexOf("Outcomes"));
  assert(
    attentionBlock.includes("https://turned.test"),
    `the newly RESTRICTED site is named under Needs attention — the verdict line must not count a site the report does not list\n${attentionBlock}`,
  );
  assert(
    /https:\/\/turned\.test\s+\S[^\n]*NO_EXPLICIT_RESTRICTION -> RESTRICTED/.test(attentionBlock),
    "with the transition it made",
  );
  assert(
    !attentionBlock.includes("https://already.test"),
    "a site already RESTRICTED last month is not listed — not news tonight",
  );
  assert(!attentionBlock.includes("https://fine.test"), "nor is a clean check");
  assert(attentionBlock.includes("https://unreadable.test"), "a check_failed site is listed");
  assert(attentionBlock.includes("https://slow.test"), "and so is a timed_out one");

  const attention = needsAttention(sweep, items);
  assert(attention.length === 3, `three sites need attention (got ${attention.length})`);
  assert(
    text.includes("Needs attention (3)"),
    "and the section header agrees with the list under it",
  );

  const counters = computeCounters(sweep, items);
  assert(counters.ok === 3, `ok counts clean checks and the transition (got ${counters.ok})`);
  assert(
    counters.failed === 2,
    `failed counts check_failed and timed_out — a policy sweep's "failed 0" must not hide them (got ${counters.failed})`,
  );
}

// ---------------------------------------------------------------------------
// A dead worker cannot read as "25 checked"
// ---------------------------------------------------------------------------

{
  const results = Array.from({ length: 25 }, (_, i) =>
    driverResult(`https://s${i}.test`, "TIMED_OUT", "NO_EXPLICIT_RESTRICTION", "NO_EXPLICIT_RESTRICTION"),
  );
  const items = results.map(toPolicyReportItem);
  const line = verdictLine(policySweep({ selectedCount: 25 }), items, { timeZone: TZ });
  assert(
    line === "Policy sweep 2026-09-10: 0 checked, 25 failed, 0 newly RESTRICTED",
    `25 attempts that never completed are 0 checked and 25 failed (got "${line}")`,
  );
}

{
  // A night where every job completed but the handler established nothing:
  // it must not read as "25 checked".
  const results = Array.from({ length: 25 }, (_, i) =>
    driverResult(`https://c${i}.test`, "COMPLETED", "NO_EXPLICIT_RESTRICTION", "CHECK_FAILED"),
  );
  const line = verdictLine(policySweep({ selectedCount: 25 }), results.map(toPolicyReportItem), {
    timeZone: TZ,
  });
  assert(
    line === "Policy sweep 2026-09-10: 0 checked, 25 failed, 0 newly RESTRICTED",
    `25 completed CHECK_FAILED jobs are 0 checked, 25 failed (got "${line}")`,
  );
}

{
  // A clean night keeps the two-number shape — no "0 failed".
  const results = [
    ...Array.from({ length: 24 }, (_, i) =>
      driverResult(`https://ok${i}.test`, "COMPLETED", "NO_EXPLICIT_RESTRICTION", "NO_EXPLICIT_RESTRICTION"),
    ),
    driverResult("https://new.test", "COMPLETED", "NO_EXPLICIT_RESTRICTION", "RESTRICTED"),
  ];
  const line = verdictLine(policySweep({ selectedCount: 25 }), results.map(toPolicyReportItem), {
    timeZone: TZ,
  });
  assert(
    line === "Policy sweep 2026-09-10: 25 checked, 1 newly RESTRICTED",
    `a night with no failures keeps the two-number shape (got "${line}")`,
  );

  // A skipped_conflict is neither checked nor failed.
  const withConflict = [
    ...results.slice(0, 24),
    driverResult("https://busy.test", "ALREADY_QUEUED", "NOT_CHECKED", "NOT_CHECKED"),
  ];
  const line2 = verdictLine(policySweep({ selectedCount: 25 }), withConflict.map(toPolicyReportItem), {
    timeZone: TZ,
  });
  assert(
    line2 === "Policy sweep 2026-09-10: 24 checked, 0 newly RESTRICTED",
    `an already-queued site is not a failure (got "${line2}")`,
  );
}

{
  // The wedged night: one site attempted, the sweep FAILED. Its verdict line
  // must say FAILED, not look like a quiet night.
  const items = [
    driverResult("https://first.test", "WEDGED", "NO_EXPLICIT_RESTRICTION", "NO_EXPLICIT_RESTRICTION"),
  ].map(toPolicyReportItem);
  const sweep = policySweep({ status: "FAILED", haltReason: "worker not draining", selectedCount: 25 });
  const line = verdictLine(sweep, items, { timeZone: TZ });
  assert(
    line === "Policy sweep 2026-09-10: FAILED — worker not draining — 1 of 25 done",
    `a FAILED sweep says so on the verdict line (got "${line}")`,
  );
  assert(
    needsAttention(sweep, items).some((a) => a.siteUrl === "https://first.test"),
    "and the site it stopped on is listed",
  );
}

// ---------------------------------------------------------------------------
// "checked" is exactly "the job COMPLETED and established a status"
// ---------------------------------------------------------------------------

{
  const ends: PolicyJobEnd[] = ["COMPLETED", "FAILED", "MISSING", "TIMED_OUT", "WEDGED", "ALREADY_QUEUED"];
  for (const end of ends) {
    for (const after of ["NO_EXPLICIT_RESTRICTION", "RESTRICTED", "CHECK_FAILED"]) {
      const items = [driverResult("https://x.test", end, "NOT_CHECKED", after)].map(toPolicyReportItem);
      const line = verdictLine(policySweep({ selectedCount: 1 }), items, { timeZone: TZ });
      const established = end === "COMPLETED" && after !== "CHECK_FAILED";
      const failed = end !== "ALREADY_QUEUED" && !established;
      const expected = established
        ? "1 checked, "
        : failed
          ? "0 checked, 1 failed, "
          : "0 checked, 0 newly";
      assert(line.includes(expected), `${end} with ${after} reads "${expected}" (got "${line}")`);
      if (end !== "COMPLETED" && after === "RESTRICTED") {
        assert(
          line.endsWith("0 newly RESTRICTED"),
          `a job that did not complete is never counted newly RESTRICTED (${end})`,
        );
        assert(
          needsAttention(policySweep(), items)[0]?.why.includes("RESTRICTED"),
          `but a status change it left behind is still named (${end})`,
        );
      }
    }
  }
}

{
  const already = driverResult("https://q.test", "ALREADY_QUEUED", "NOT_CHECKED", "NOT_CHECKED");
  assert(already.outcome === "skipped_conflict", "an already-queued site is skipped_conflict");
  const counters = computeCounters(policySweep(), [toPolicyReportItem(already)]);
  assert(counters.skippedConflict === 1, "and counted as a conflict");
}

// ---------------------------------------------------------------------------
// The row and the report are the same result
// ---------------------------------------------------------------------------

{
  const r = driverResult("https://row.test", "COMPLETED", "NO_EXPLICIT_RESTRICTION", "RESTRICTED", "REVIEW");
  const row = toPolicyItemRow(r, "pol1");
  const item = toPolicyReportItem(r);

  assert(row.siteStatus === "REVIEW", "the row's siteStatus is the lifecycle status");
  assert(item.siteStatus === row.siteStatus, "and the report's is identical");
  assert(row.policyStatusBefore === "NO_EXPLICIT_RESTRICTION", "the previous policy status has its own column");
  assert(row.policyStatusAfter === "RESTRICTED", "and so does the resulting one");
  assert(row.wouldPromoteTo === null, "wouldPromoteTo is not reused for a policy status");
  assert(row.failureCategory === null, "nor is failureCategory");
  assert(row.outcome === item.outcome && row.phase === "policy", "outcome and phase agree");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("policySweepReport: the verdict counts what the report lists, and checked means a status was established");
