// Run: npx tsx worker/lib/sweepSelection.test.ts
//
// Three rules that must agree, tested together because the cost of them
// disagreeing is silent: a site that is "too fresh to scrape" and "never
// succeeded" at the same time is never scraped again and never reported.

import {
  DEFAULT_FRESH_WINDOW_MS,
  classifyOutcome,
  compareByLastAttempt,
  isSuccessfulRun,
  selectSitesForSweep,
  type SelectableSite,
} from "./sweepSelection";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const NOW = new Date("2026-09-14T03:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const mapping = { title: { selector: "h1" } };

function site(over: Partial<SelectableSite> = {}): SelectableSite {
  return {
    id: over.id ?? "s1",
    siteUrl: over.siteUrl ?? "https://example.test",
    status: over.status ?? "ACTIVE",
    fieldMappings: "fieldMappings" in over ? over.fieldMappings : mapping,
    lastSuccessAt: "lastSuccessAt" in over ? over.lastSuccessAt! : hoursAgo(40),
    lastAttemptAt: "lastAttemptAt" in over ? over.lastAttemptAt! : hoursAgo(40),
  };
}

// ---------------------------------------------------------------------------
// Success (N5) — the definition the other two rules are built on
// ---------------------------------------------------------------------------

assert(
  isSuccessfulRun({ status: "COMPLETED", failureCategory: null }),
  "COMPLETED with no category is success",
);

// The whole point of the definition. Both of these write COMPLETED.
for (const cat of ["empty_results", "structure_changed"]) {
  assert(
    !isSuccessfulRun({ status: "COMPLETED", failureCategory: cat }),
    `COMPLETED + ${cat} is NOT success — a run that found nothing is not a run that worked`,
  );
}

assert(!isSuccessfulRun({ status: "FAILED", failureCategory: "timeout" }), "FAILED is not success");
assert(!isSuccessfulRun({ status: "PARTIAL", failureCategory: null }), "PARTIAL is not success");
assert(!isSuccessfulRun({ status: "IN_PROGRESS", failureCategory: null }), "an open run is not success");
assert(!isSuccessfulRun(null), "no run at all is not success");

// The same run must fail all three uses, since one definition drives them.
{
  const emptyRun = { status: "COMPLETED", failureCategory: "empty_results" };
  assert(!isSuccessfulRun(emptyRun), "1. does not count as a recent success");
  assert(classifyOutcome(emptyRun) !== "success", "2. does not reset the breaker");
  const s = site({ lastSuccessAt: null, lastAttemptAt: hoursAgo(1) });
  assert(
    selectSitesForSweep([s], { now: NOW }).selected.length === 1,
    "3. does not satisfy the 20h window — the site is still due",
  );
}

// ---------------------------------------------------------------------------
// Breaker classification
// ---------------------------------------------------------------------------

assert(
  classifyOutcome({ status: "FAILED", failureCategory: "timeout" }) === "hard_failure",
  "a timeout is a hard failure",
);
assert(
  classifyOutcome({ status: "FAILED", failureCategory: "other" }) === "hard_failure",
  "so is an uncategorised error",
);
assert(
  classifyOutcome({ status: "COMPLETED", failureCategory: "empty_results" }) === "soft_failure",
  "empty_results is soft — per-site config death, not infrastructure",
);
assert(
  classifyOutcome({ status: "FAILED", failureCategory: "apply_requires_login" }) === "other",
  "a login-gated skip is a decision, not a fault, and must never halt the sweep",
);
assert(
  classifyOutcome({ status: "FAILED", failureCategory: "orphaned" }) === "other",
  "a reaped orphan is not evidence about tonight's infrastructure",
);

{
  // The undersize guard's refusal: FAILED, listings kept.
  const refused = { status: "FAILED", failureCategory: "suspicious_drop" };
  assert(
    classifyOutcome(refused) === "suspicious_drop",
    `a refused drop is its own outcome (got ${classifyOutcome(refused)})`,
  );
  assert(!isSuccessfulRun(refused), "and never a success — the site stays due tomorrow");
  assert(classifyOutcome(refused) !== "hard_failure", "nor a hard failure — it is a decision, not a fault");
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

{
  const sites = [
    site({ id: "active_due" }),
    site({ id: "review_due", status: "REVIEW" }),
    site({ id: "failed", status: "FAILED" }),
    site({ id: "skipped", status: "SKIPPED" }),
    site({ id: "analyzing", status: "ANALYZING" }),
  ];
  const { selected } = selectSitesForSweep(sites, { now: NOW });
  const ids = selected.map((s) => s.id).sort();
  assert(
    ids.length === 2 && ids[0] === "active_due" && ids[1] === "review_due",
    `only ACTIVE and REVIEW are swept (got ${ids.join(",")})`,
  );
}

{
  // The Jobinfo case: fieldMappings = {} would reach failScrapeRun and, on a
  // manual run, wipe. Selecting it queues a site we already know will fail.
  const cases: Array<[string, unknown]> = [
    ["empty object", {}],
    ["null", null],
    ["only _meta", { _meta: { applyRequiresLogin: false } }],
    ["entry with no selector", { title: { sample: "x" } }],
    ["entry that is not an object", { title: "h1" }],
    ["an array", [{ selector: "h1" }]],
  ];
  for (const [name, fm] of cases) {
    const { selected, excluded } = selectSitesForSweep([site({ fieldMappings: fm })], {
      now: NOW,
    });
    assert(selected.length === 0, `excluded: fieldMappings is ${name}`);
    assert(
      excluded[0]?.reason.includes("usable fieldMappings"),
      `and says why, for ${name}`,
    );
  }

  // ...but a real mapping alongside _meta is fine.
  assert(
    selectSitesForSweep(
      [site({ fieldMappings: { _meta: { x: 1 }, title: { selector: "h1" } } })],
      { now: NOW },
    ).selected.length === 1,
    "_meta alongside a real mapping still counts as usable",
  );
}

{
  const gated = site({ fieldMappings: { _meta: { applyRequiresLogin: true }, title: { selector: "h1" } } });
  const { selected, excluded } = selectSitesForSweep([gated], { now: NOW });
  assert(selected.length === 0, "applyRequiresLogin sites are excluded");
  assert(excluded[0]?.reason.includes("applyRequiresLogin"), "and named as such");
}

{
  // The 20h window, on last SUCCESS.
  const fresh = site({ id: "fresh", lastSuccessAt: hoursAgo(2) });
  const stale = site({ id: "stale", lastSuccessAt: hoursAgo(21) });
  const never = site({ id: "never", lastSuccessAt: null });
  const { selected } = selectSitesForSweep([fresh, stale, never], { now: NOW });
  const ids = selected.map((s) => s.id).sort();
  assert(
    ids.length === 2 && ids.includes("stale") && ids.includes("never"),
    `fresh sites are skipped, stale and never-succeeded are due (got ${ids.join(",")})`,
  );
}

{
  // The boundary is exclusive on the window: exactly 20h old is due.
  const exactly = site({ lastSuccessAt: new Date(NOW.getTime() - DEFAULT_FRESH_WINDOW_MS) });
  assert(
    selectSitesForSweep([exactly], { now: NOW }).selected.length === 1,
    "a success exactly at the window edge no longer counts as fresh",
  );
}

// ---------------------------------------------------------------------------
// Ordering (R6) — by last ATTEMPT, never by last success
// ---------------------------------------------------------------------------

{
  // The scenario the rule exists for: a permanently-broken site that is tried
  // every night. By last success it is always first, so three of them halt the
  // sweep before it reaches anything healthy — every night, the same three.
  const broken = site({ id: "broken", lastSuccessAt: hoursAgo(24 * 90), lastAttemptAt: hoursAgo(1) });
  const healthyStale = site({ id: "healthy", lastSuccessAt: hoursAgo(30), lastAttemptAt: hoursAgo(30) });

  const order = selectSitesForSweep([broken, healthyStale], { now: NOW }).selected.map((s) => s.id);
  assert(
    order[0] === "healthy",
    `the site tried longest ago goes first, not the one that succeeded longest ago (got ${order.join(",")})`,
  );
}

{
  const never = site({ id: "never", lastAttemptAt: null, lastSuccessAt: null });
  const old = site({ id: "old", lastAttemptAt: hoursAgo(100), lastSuccessAt: null });
  const order = selectSitesForSweep([old, never], { now: NOW }).selected.map((s) => s.id);
  assert(order[0] === "never", "never-attempted sites lead — nothing is known about them");
}

{
  // Deterministic, so two --dry-run passes agree and a report can be compared.
  const a = site({ id: "aaa", lastAttemptAt: hoursAgo(5), lastSuccessAt: null });
  const b = site({ id: "bbb", lastAttemptAt: hoursAgo(5), lastSuccessAt: null });
  assert(compareByLastAttempt(a, b) < 0, "ties break by id, so ordering is stable");
  const o1 = selectSitesForSweep([b, a], { now: NOW }).selected.map((s) => s.id);
  const o2 = selectSitesForSweep([a, b], { now: NOW }).selected.map((s) => s.id);
  assert(o1.join() === o2.join(), "and input order does not change the result");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sweepSelection: success, selection and ordering agree");
