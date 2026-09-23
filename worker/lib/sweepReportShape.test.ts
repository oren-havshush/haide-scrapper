// Run: npx tsx worker/lib/sweepReportShape.test.ts
//
// The report is read once a morning, by one person, half asleep. Everything
// here is about it staying readable and staying true — four rules that the
// step 9 catch-up run and the listingUrls work between them showed it needs.
//
//   1. Warnings name sites only where the site is the point. 61 of 140 sites
//      warned that night, mostly about location quality; a queue that long is
//      one nobody reads, and the two warnings an operator acts on per SITE are
//      job_count_drop and near_timeout.
//   2. A listing refusal is not silent drift. Drift is a site that changed
//      under us and said nothing; a refusal is the worker declining to shrink
//      what it publishes. They are opposites, and only one is a problem.
//   3. `empty_results` on a site that had no jobs to begin with is "no jobs",
//      not a regression. Counting it as drift puts a site that has been empty
//      for a month in the same bucket as one that emptied last night.
//   4. Fresh-window skips are one line. On a re-run they are nearly the whole
//      fleet, and 140 lines of "succeeded 3h ago" buries the two selections
//      that were skipped for a reason someone has to fix.

import {
  computeCounters,
  needsAttention,
  renderSweepReport,
  type ReportItem,
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
const STARTED = new Date("2026-09-10T00:05:00Z");

function sweep(over: Partial<ReportSweep> = {}): ReportSweep {
  return {
    id: "sw1",
    kind: "SCRAPE",
    status: "COMPLETED",
    trigger: "timer",
    startedAt: STARTED,
    finishedAt: new Date(STARTED.getTime() + 90 * 60_000),
    selectedCount: 145,
    haltReason: null,
    ...over,
  };
}

function item(over: Partial<ReportItem> = {}): ReportItem {
  return {
    siteId: over.siteId ?? "s1",
    siteUrl: over.siteUrl ?? "https://a.test",
    phase: "scrape",
    outcome: "success",
    failureCategory: null,
    jobsBefore: 10,
    jobsAfter: 10,
    newestJobAt: new Date(STARTED.getTime() + 60_000),
    siteStatus: "ACTIVE",
    wouldDemoteTo: null,
    wouldPromoteTo: null,
    ...over,
  };
}

const render = (items: ReportItem[], opts: Partial<Parameters<typeof renderSweepReport>[2]> = {}) =>
  renderSweepReport(sweep(), items, { timeZone: TZ, ...opts });

// ---------------------------------------------------------------------------
console.log("# 1 — warnings name sites only where the site is the point");
// ---------------------------------------------------------------------------
{
  const items = [
    item({
      siteId: "a", siteUrl: "https://a.test",
      warnings: ["job_count_drop: 40 -> 22", "unknown_location: 12 job(s)"],
    }),
    item({
      siteId: "b", siteUrl: "https://b.test",
      warnings: ["near_timeout: 13m of a 15m budget", "unknown_location: 3 job(s)"],
    }),
    item({
      siteId: "c", siteUrl: "https://c.test",
      warnings: ["unknown_location: 1 job(s)", "non_place_location: \"מהבית\"×2 — not a workplace"],
    }),
  ];
  const text = render(items);

  assert(text.includes("Warnings (3 sites)"), `the header still counts sites\n${text}`);
  assert(/unknown_location \(3\)/.test(text), "every type still shows its count");
  assert(/non_place_location \(1\)/.test(text), "including the rare ones");

  // The two an operator acts on per site.
  assert(
    /job_count_drop \(1\)\n\s+https:\/\/a\.test — 40 -> 22/.test(text),
    `job_count_drop names its site and detail\n${text}`,
  );
  assert(
    /near_timeout \(1\)\n\s+https:\/\/b\.test — 13m of a 15m budget/.test(text),
    `near_timeout names its site and detail\n${text}`,
  );

  // The rest are a count and nothing more.
  const warnSection = text.slice(text.indexOf("Warnings ("));
  const unknownBlock = warnSection.slice(warnSection.indexOf("unknown_location"));
  assert(
    !/unknown_location \(3\)\n\s+https:/.test(warnSection),
    `unknown_location lists no sites\n${unknownBlock.slice(0, 200)}`,
  );
  assert(
    !warnSection.includes("https://c.test"),
    "a site whose only warnings are of the counted kind is not named at all",
  );
  assert(
    (warnSection.match(/https:\/\//g) ?? []).length === 2,
    `exactly two site lines in the whole warnings section (got ${(warnSection.match(/https:\/\//g) ?? []).length})`,
  );
}

// ---------------------------------------------------------------------------
console.log("# 2 — a listing refusal is not drift, and it protected listings");
// ---------------------------------------------------------------------------
{
  // A multi-page site whose head-office page went dark. Nothing was deleted;
  // the 40 listings it already publishes are still there.
  const refusal = item({
    outcome: "soft_failure",
    failureCategory: "listing_url_empty",
    jobsBefore: 40,
    jobsAfter: 40,
    warnings: ["listing_url_empty: https://x.test/head-office yielded 0, had 8"],
  });
  const c = computeCounters(sweep(), [refusal]);

  assert(c.silentDrift === 0, "a refusal is not counted as silent drift");
  assert(c.listingRefusals === 1, "it is counted as a refusal");
  assert(
    c.listingsProtected === 1,
    "and as listings protected — a manual run would have published the shrunken set and deleted the rest",
  );

  // All three listing categories, since only two of them are scheduled-only.
  for (const cat of ["listing_url_failed", "listing_url_empty", "listing_urls_removed"]) {
    const n = computeCounters(sweep(), [
      item({ outcome: "soft_failure", failureCategory: cat, jobsBefore: 40, jobsAfter: 40 }),
    ]);
    assert(n.listingRefusals === 1 && n.silentDrift === 0, `${cat} counts as a refusal, not drift`);
  }

  // Genuine drift still is drift, and protects nothing — the site really did
  // change under us and the rows that are there are the rows that are there.
  const drift = item({
    siteId: "d",
    siteUrl: "https://drifted.test",
    outcome: "soft_failure",
    failureCategory: "structure_changed",
    jobsBefore: 19,
    jobsAfter: 19,
  });
  const d = computeCounters(sweep(), [drift]);
  assert(d.silentDrift === 1, "structure_changed is still drift");
  assert(d.listingRefusals === 0 && d.listingsProtected === 0, "and protects nothing");

  const text = render([refusal, drift]);
  assert(
    /1\s+silent drift \(empty_results \/ structure_changed\)/.test(text),
    `drift and refusals have separate lines\n${text}`,
  );
  assert(
    /1\s+refused to publish a partial set \(listing_\*\)/.test(text),
    `the refusals get their own line\n${text}`,
  );
}

// ---------------------------------------------------------------------------
console.log("# 3 — empty_results on a site that had nothing is 'no jobs'");
// ---------------------------------------------------------------------------
{
  // A site that has published nothing for weeks. Every night it returns zero,
  // and every night it was counted as a site that "changed under us".
  const none = item({
    outcome: "soft_failure",
    failureCategory: "empty_results",
    jobsBefore: 0,
    jobsAfter: 0,
  });
  const c = computeCounters(sweep(), [none]);
  assert(c.noJobs === 1, "it is counted as a site with no jobs");
  assert(c.silentDrift === 0, "and not as drift");
  assert(c.listingsProtected === 0, "it had nothing to protect");

  // A site that HAD jobs and now returns none is the real thing, and must stay.
  const emptied = item({
    outcome: "soft_failure",
    failureCategory: "empty_results",
    jobsBefore: 19,
    jobsAfter: 19,
  });
  const e = computeCounters(sweep(), [emptied]);
  assert(e.silentDrift === 1, "a site that HAD jobs and returned none is still drift");
  assert(e.noJobs === 0, "and is not filed under no jobs");

  // The queue distinguishes them, and keeps BOTH.
  //
  // Dropping the no-jobs sites was the first version of this change, and the
  // real step 9 fixture refused it: all four sites in that state that night —
  // se.com, xnes, careers.jnj.com, safelog — were broken configs, since
  // rebuilt or retired. "Has no jobs and never had any" is not drift, but it
  // is not nothing either; it is the shape a config that has never worked
  // takes, and the report cannot tell that from a company between hiring
  // rounds. So it is named, in its own words.
  const q = needsAttention(sweep(), [none], { timeZone: TZ });
  assert(q.length === 1, `a site with no jobs is still named (got ${JSON.stringify(q)})`);
  assert(
    /no jobs, and has none stored/.test(q[0]?.why ?? ""),
    `and in its own words, not as drift (got ${JSON.stringify(q[0]?.why)})`,
  );
  assert(!/silent drift/.test(q[0]?.why ?? ""), "explicitly not as drift");

  const q2 = needsAttention(sweep(), [emptied], { timeZone: TZ });
  assert(q2.length === 1 && /silent drift/.test(q2[0]!.why), "a site that emptied out is drift");

  const text = render([none]);
  assert(/1\s+returned no jobs and had none/.test(text), `and the report says so\n${text}`);
}

// ---------------------------------------------------------------------------
console.log("# 4 — fresh-window skips are one line");
// ---------------------------------------------------------------------------
{
  const skipped = [
    ...Array.from({ length: 138 }, (_, i) => ({
      siteUrl: `https://f${i}.test`,
      reason: "succeeded 3h ago, inside the 20h window",
      kind: "fresh" as const,
    })),
    { siteUrl: "https://broken.test", reason: "no usable fieldMappings (would fail immediately)" },
    { siteUrl: "https://login.test", reason: "applyRequiresLogin — nothing can be applied to" },
  ];
  const text = render([item()], { skipped });

  assert(text.includes("skipped   140 at selection"), `the total is unchanged\n${text}`);
  assert(
    /138 too recent to scrape \(inside the fresh window\)/.test(text),
    `the fresh-window skips collapse to one line\n${text}`,
  );
  assert(
    text.includes("https://broken.test — no usable fieldMappings"),
    "a skip someone has to fix is still named",
  );
  assert(text.includes("https://login.test — applyRequiresLogin"), "and so is the other kind");
  assert(!text.includes("https://f0.test"), "no fresh-window site is named");
  assert(
    (text.match(/https:\/\/f\d+\.test/g) ?? []).length === 0,
    "not one of the 138",
  );

  // With no fresh skips at all the line does not appear.
  const plain = render([item()], {
    skipped: [{ siteUrl: "https://broken.test", reason: "no usable fieldMappings" }],
  });
  assert(!/too recent to scrape/.test(plain), "and the line is absent when nothing was fresh-skipped");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nsweepReportShape: the morning report stays readable, and stays true");
