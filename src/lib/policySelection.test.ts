// Run: npx tsx src/lib/policySelection.test.ts
//
// One rule, two callers. The nightly policy sweep and
// scripts/backfill-policy-review.ts differ in who is eligible, but must not
// differ on when a check is stale — otherwise a site can be overdue to one and
// fresh to the other on the same evening, and "due for a policy check" quietly
// means two things.

import {
  becameRestricted,
  compareByPolicyCheckedAt,
  isRestricting,
  selectDuePolicyReviews,
  type PolicyCandidate,
} from "./policySelection";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const NOW = new Date("2026-09-14T03:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const RECHECK = 90;

function site(over: Partial<PolicyCandidate> = {}): PolicyCandidate {
  return {
    id: over.id ?? "s1",
    siteUrl: over.siteUrl ?? "https://s1.test",
    status: over.status ?? "ACTIVE",
    scrapingPolicyStatus: over.scrapingPolicyStatus ?? "NO_EXPLICIT_RESTRICTION",
    scrapingPolicyCheckedAt:
      "scrapingPolicyCheckedAt" in over ? over.scrapingPolicyCheckedAt! : daysAgo(120),
    companyProfileAt: "companyProfileAt" in over ? over.companyProfileAt! : daysAgo(200),
  };
}

/** What the nightly sweep passes. */
const sweepOpts = {
  now: NOW,
  recheckIntervalDays: RECHECK,
  limit: 25,
  statuses: ["ACTIVE", "REVIEW"] as const,
  requireCompanyProfile: true,
};

/** What the backfill passes with no flags. */
const backfillOpts = {
  now: NOW,
  recheckIntervalDays: RECHECK,
  requireCompanyProfile: false,
};

// ---------------------------------------------------------------------------
// The interval boundary, both ways
// ---------------------------------------------------------------------------

{
  const never = site({ id: "never", scrapingPolicyCheckedAt: null });
  assert(
    selectDuePolicyReviews([never], sweepOpts).selected.length === 1,
    "never checked is always due",
  );

  const justInside = site({ id: "in", scrapingPolicyCheckedAt: daysAgo(RECHECK - 1) });
  assert(
    selectDuePolicyReviews([justInside], sweepOpts).selected.length === 0,
    "89 days ago is inside the interval and not due",
  );

  const exactly = site({ id: "at", scrapingPolicyCheckedAt: daysAgo(RECHECK) });
  assert(
    selectDuePolicyReviews([exactly], sweepOpts).selected.length === 1,
    "exactly 90 days ago is due — the boundary is inclusive of the far side",
  );

  const wellPast = site({ id: "past", scrapingPolicyCheckedAt: daysAgo(RECHECK + 1) });
  assert(
    selectDuePolicyReviews([wellPast], sweepOpts).selected.length === 1,
    "91 days ago is due",
  );

  const excl = selectDuePolicyReviews([justInside], sweepOpts).excluded;
  assert(
    excl[0]?.reason.includes("inside the 90d interval"),
    "and a fresh site says why it was skipped",
  );
}

// ---------------------------------------------------------------------------
// Eligibility — the sweep's extra filters
// ---------------------------------------------------------------------------

{
  const noProfile = site({ id: "np", companyProfileAt: null });
  assert(
    selectDuePolicyReviews([noProfile], sweepOpts).selected.length === 0,
    "the sweep skips a site whose company profile was never captured",
  );
  assert(
    selectDuePolicyReviews([noProfile], backfillOpts).selected.length === 1,
    "the backfill does not — it is also used before a site is onboarded",
  );
}

{
  // companyProfileStatus PARTIAL still counts: a policy check needs no logo.
  // That is why the filter is on the timestamp, not the status.
  const partial = site({ id: "p", companyProfileAt: daysAgo(10) });
  assert(
    selectDuePolicyReviews([partial], sweepOpts).selected.length === 1,
    "a PARTIAL profile still has companyProfileAt, so the site is checked",
  );
}

{
  const sites = [
    site({ id: "a", status: "ACTIVE" }),
    site({ id: "r", status: "REVIEW" }),
    site({ id: "f", status: "FAILED" }),
    site({ id: "s", status: "SKIPPED" }),
    site({ id: "z", status: "ANALYZING" }),
  ];
  const ids = selectDuePolicyReviews(sites, sweepOpts).selected.map((s) => s.id).sort();
  assert(ids.join() === "a,r", `the sweep checks ACTIVE and REVIEW only (got ${ids.join()})`);

  // The backfill's --status is a single value, kept as it was.
  const only = selectDuePolicyReviews(sites, { ...backfillOpts, status: "FAILED" }).selected;
  assert(only.length === 1 && only[0].id === "f", "the backfill's --status still works");
}

// ---------------------------------------------------------------------------
// --force skips the interval, never the eligibility
// ---------------------------------------------------------------------------

{
  const fresh = site({ id: "f", scrapingPolicyCheckedAt: daysAgo(1) });
  assert(
    selectDuePolicyReviews([fresh], backfillOpts).selected.length === 0,
    "a site checked yesterday is not due",
  );
  assert(
    selectDuePolicyReviews([fresh], { ...backfillOpts, force: true }).selected.length === 1,
    "--force re-checks it anyway",
  );

  const wrongStatus = site({ id: "w", status: "FAILED", scrapingPolicyCheckedAt: daysAgo(1) });
  assert(
    selectDuePolicyReviews([wrongStatus], { ...sweepOpts, force: true }).selected.length === 0,
    "--force does NOT override eligibility — it would otherwise mean 'check sites the sweep excludes'",
  );
}

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

{
  const many = Array.from({ length: 40 }, (_, i) =>
    site({
      id: `s${String(i).padStart(2, "0")}`,
      siteUrl: `https://s${i}.test`,
      scrapingPolicyCheckedAt: daysAgo(100 + i),
    }),
  );
  const r = selectDuePolicyReviews(many, { ...sweepOpts, limit: 25 });
  assert(r.selected.length === 25, "the cap limits the night to 25");
  assert(r.cappedOut === 15, "and reports how many were left");

  // The cap applies AFTER ordering, so a capped night takes the MOST overdue.
  assert(
    r.selected[0].id === "s39",
    `the oldest check leads (got ${r.selected[0].id}) — a cap must not take an arbitrary slice`,
  );
  assert(
    !r.selected.some((s) => s.id === "s00"),
    "and the most recently checked is the one left out",
  );

  const uncapped = selectDuePolicyReviews(many, backfillOpts);
  assert(uncapped.selected.length === 40, "no limit means no cap");
  assert(uncapped.cappedOut === 0, "and nothing reported as capped");
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

{
  const never = site({ id: "n", scrapingPolicyCheckedAt: null });
  const old = site({ id: "o", scrapingPolicyCheckedAt: daysAgo(300) });
  const order = selectDuePolicyReviews([old, never], sweepOpts).selected.map((s) => s.id);
  assert(order[0] === "n", "never-checked sites lead");

  const a = site({ id: "aaa", scrapingPolicyCheckedAt: daysAgo(100) });
  const b = site({ id: "bbb", scrapingPolicyCheckedAt: daysAgo(100) });
  assert(compareByPolicyCheckedAt(a, b) < 0, "ties break by id, so two runs agree");
}

// ---------------------------------------------------------------------------
// The two callers agree on the same fixture
// ---------------------------------------------------------------------------

{
  // Given a fixture where every site is ACTIVE with a captured profile, the
  // sweep and the backfill (`--status ACTIVE`) must select exactly the same
  // sites in the same order. If they ever diverge, "due" has become two rules.
  const fixture = [
    site({ id: "a", siteUrl: "https://a.test", scrapingPolicyCheckedAt: daysAgo(200) }),
    site({ id: "b", siteUrl: "https://b.test", scrapingPolicyCheckedAt: null }),
    site({ id: "c", siteUrl: "https://c.test", scrapingPolicyCheckedAt: daysAgo(10) }),
    site({ id: "d", siteUrl: "https://d.test", scrapingPolicyCheckedAt: daysAgo(91) }),
  ];

  const fromSweep = selectDuePolicyReviews(fixture, {
    now: NOW,
    recheckIntervalDays: RECHECK,
    limit: 25,
    statuses: ["ACTIVE", "REVIEW"],
    requireCompanyProfile: true,
  }).selected.map((s) => s.id);

  const fromBackfill = selectDuePolicyReviews(fixture, {
    now: NOW,
    recheckIntervalDays: RECHECK,
    status: "ACTIVE",
    requireCompanyProfile: false,
  }).selected.map((s) => s.id);

  assert(
    fromSweep.join() === fromBackfill.join(),
    `the sweep and the backfill agree on the same fixture (sweep: ${fromSweep.join()}, backfill: ${fromBackfill.join()})`,
  );
  assert(fromSweep.join() === "b,a,d", `and the order is oldest-first (got ${fromSweep.join()})`);
  assert(!fromSweep.includes("c"), "with the recently-checked site excluded by both");
}

// ---------------------------------------------------------------------------
// "Newly" RESTRICTED is a transition, not a census
// ---------------------------------------------------------------------------

assert(isRestricting("RESTRICTED"), "RESTRICTED restricts");
assert(isRestricting("REQUIRES_WRITTEN_PERMISSION"), "so does REQUIRES_WRITTEN_PERMISSION");
assert(!isRestricting("NO_EXPLICIT_RESTRICTION"), "an unrestricted site does not");
assert(!isRestricting("CHECK_FAILED"), "nor does a failed check");
assert(!isRestricting(null), "nor null");

assert(
  becameRestricted("NO_EXPLICIT_RESTRICTION", "RESTRICTED"),
  "unrestricted -> RESTRICTED is newly restricted",
);
assert(
  becameRestricted("NOT_CHECKED", "REQUIRES_WRITTEN_PERMISSION"),
  "a first check that finds a restriction is newly restricted",
);
assert(
  !becameRestricted("RESTRICTED", "RESTRICTED"),
  "a site already RESTRICTED last month is NOT news tonight — this is the whole point",
);
assert(
  !becameRestricted("RESTRICTED", "REQUIRES_WRITTEN_PERMISSION"),
  "nor is moving between two restricting statuses",
);
assert(
  !becameRestricted("RESTRICTED", "NO_EXPLICIT_RESTRICTION"),
  "and a site that stopped restricting is not newly restricted",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("policySelection: one staleness rule, two callers, and 'newly' means a change");
