// Run: npx tsx worker/lib/listingTargets.test.ts
//
// One property holds this file together:
//
//   A page that stops producing jobs must never shrink what the site publishes.
//
// Persistence is delete-all-then-insert per site, so the merged set from every
// listing page IS the site's published state. If one department page errors,
// goes dark, or drops out of the config, the only safe answer is to write
// nothing and say so — the alternative is deleting that department's jobs from
// the public site with no signal. Most of the assertions below exist to catch a
// change that quietly turns one of those refusals into a commit.
//
// The second property is that a site without listingUrls behaves exactly as it
// does today: one target, no new warnings, failures thrown not swallowed.

import {
  BUDGET_EXHAUSTED,
  DEFAULT_LISTING_DROP_THRESHOLDS,
  LISTING_SOFT_CATEGORIES,
  LISTING_URL_EMPTY,
  LISTING_URL_FAILED,
  LISTING_URL_TAG,
  LISTING_URLS_REMOVED,
  canonicalListingUrl,
  decideListingOutcome,
  getListingUrls,
  listingBudgetExhausted,
  mergeListingResults,
  previousCountsByUrl,
  resolveListingTargets,
  savedCountsByUrl,
  type ListingUrlResult,
} from "./listingTargets";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

/** A block that throws is a failure of that block, not the end of the run. */
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const SITE = "https://renuar.test/pages/careers";
const STORES = "https://renuar.test/pages/stores";
const HQ = "https://renuar.test/pages/hq";
const LOGI = "https://renuar.test/pages/logistics";

function items(n: number, url: string): Record<string, string>[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `job ${i}`,
    [LISTING_URL_TAG]: url,
  }));
}

function res(
  url: string,
  n: number,
  over: Partial<ListingUrlResult> = {},
): ListingUrlResult {
  return {
    url,
    items: "items" in over ? over.items! : items(n, url),
    seen: "seen" in over ? over.seen! : n,
    error: over.error ?? null,
  };
}

function decide(
  perUrl: ListingUrlResult[],
  over: {
    targets?: string[];
    previous?: Record<string, number>;
    scheduled?: boolean;
  } = {},
) {
  return decideListingOutcome({
    perUrl,
    targets: (over.targets ?? perUrl.map((r) => r.url)).map((url) => ({ url })),
    previous: new Map(Object.entries(over.previous ?? {})),
    scheduled: over.scheduled ?? true,
  });
}

// ---------------------------------------------------------------------------
// Reading the config
// ---------------------------------------------------------------------------

check("canonicalListingUrl", () => {
  assert(canonicalListingUrl(" https://a.test/x ") === "https://a.test/x", "trims");
  assert(canonicalListingUrl("javascript:alert(1)") === null, "rejects non-http(s)");
  assert(canonicalListingUrl("ftp://a.test/x") === null, "rejects ftp");
  assert(canonicalListingUrl("not a url") === null, "rejects garbage");
  assert(canonicalListingUrl(42) === null, "rejects non-strings");
  assert(canonicalListingUrl("") === null, "rejects empty");
});

check("getListingUrls tolerates junk", () => {
  for (const input of [undefined, null, {}, { _meta: {} }, { _meta: { listingUrls: null } }, "x"]) {
    assert(getListingUrls(input).length === 0, `no config -> [] (${JSON.stringify(input)})`);
  }
  const got = getListingUrls({
    _meta: { listingUrls: [` ${STORES} `, HQ, 42, "", "bad url", STORES] },
  });
  assert(got.length === 2, `trims, drops junk and duplicates (got ${got.length})`);
  assert(got[0]!.url === STORES && got[1]!.url === HQ, "and keeps configured order");
});

// ---------------------------------------------------------------------------
// Targets: the list REPLACES siteUrl
// ---------------------------------------------------------------------------

check("resolveListingTargets", () => {
  const none = resolveListingTargets({ siteUrl: SITE, listingUrls: [] });
  assert(none.length === 1 && none[0]!.url === SITE, "unset -> the site's own URL, unchanged");

  const set = resolveListingTargets({
    siteUrl: SITE,
    listingUrls: [{ url: STORES }, { url: HQ }],
  });
  assert(set.length === 2, `set -> exactly the configured pages (got ${set.length})`);
  assert(
    !set.some((t) => t.url === SITE),
    "and siteUrl is NOT appended — a hub would be scraped as a permanently empty page",
  );
});

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

check("mergeListingResults", () => {
  const m = mergeListingResults([res(STORES, 28), res(HQ, 8), res(LOGI, 1)]);
  assert(m.items.length === 37, `every page's items are kept (got ${m.items.length})`);
  assert(
    m.listingItemsSeen === 37,
    `listingItemsSeen accumulates across pages (got ${m.listingItemsSeen}) — ` +
      "taking the last page's count would make listing_vs_saved_gap fire every run",
  );
  assert(m.failedUrls.length === 0, "nothing failed");

  const withFail = mergeListingResults([
    res(STORES, 28),
    res(HQ, 0, { error: "boom", seen: null }),
  ]);
  assert(withFail.items.length === 28, "a failed page contributes no items");
  assert(withFail.failedUrls[0]?.url === HQ, "and is reported by URL");

  assert(mergeListingResults([res(STORES, 3, { seen: null })]).listingItemsSeen === null,
    "all-null seen stays null");
  assert(
    mergeListingResults([res(STORES, 3, { seen: null }), res(HQ, 5)]).listingItemsSeen === 5,
    "one countable page still gives a count",
  );
});

check("counting rows by page", () => {
  // Shaped as the GROUP BY returns it: NULL url for rows with no tag, bigint count.
  const prev = previousCountsByUrl([
    { url: STORES, n: BigInt(2) },
    { url: HQ, n: BigInt(1) },
    { url: null, n: BigInt(2) },
  ]);
  assert(prev.get(STORES) === 2 && prev.get(HQ) === 1, "tagged rows count per page");
  assert(
    prev.get("") === 2,
    "untagged rows count under '' — rows written before this feature must never " +
      "look like they belong to a page that has since been removed",
  );
  assert(typeof prev.get(STORES) === "number", "bigint counts become numbers");

  const saved = savedCountsByUrl([...items(2, STORES), ...items(1, HQ), { title: "x" }]);
  assert(saved.get(STORES) === 2 && saved.get(HQ) === 1 && saved.get("") === 1, "same for saved rows");
});

// ---------------------------------------------------------------------------
// The decision — failures
// ---------------------------------------------------------------------------

check("all targets failed -> rethrow", () => {
  const one = decide([res(SITE, 0, { error: "net::ERR", seen: null })]);
  assert(
    one.kind === "rethrow",
    `a single-URL site that fails must throw, exactly as today (got ${one.kind})`,
  );

  const all = decide([
    res(STORES, 0, { error: "net::ERR", seen: null }),
    res(HQ, 0, { error: "net::ERR", seen: null }),
  ]);
  assert(all.kind === "rethrow", "every page failing is a site failure, not a soft one");
});

check("some targets failed -> refuse, nothing written", () => {
  const out = decide([
    res(STORES, 28),
    res(HQ, 0, { error: "Timeout 30000ms exceeded", seen: null }),
    res(LOGI, 1),
  ]);
  assert(out.kind === "soft_fail", `partial failure refuses (got ${out.kind})`);
  if (out.kind === "soft_fail") {
    assert(out.failureCategory === LISTING_URL_FAILED, "categorised as listing_url_failed");
    assert(out.error.includes(HQ), "and names the page that failed");
  }
});

check("budget exhaustion is just another failed target", () => {
  const out = decide([res(STORES, 28), res(HQ, 0, { error: BUDGET_EXHAUSTED, seen: null })]);
  assert(
    out.kind === "soft_fail",
    "a page we ran out of time for must not publish the pages we did reach",
  );
});

// ---------------------------------------------------------------------------
// The decision — a page going dark
// ---------------------------------------------------------------------------

check("a page that had rows and now yields none -> refuse", () => {
  const out = decide([res(STORES, 28), res(HQ, 0), res(LOGI, 1)], {
    previous: { [STORES]: 28, [HQ]: 8, [LOGI]: 1 },
    scheduled: true,
  });
  assert(
    out.kind === "soft_fail",
    `a dark page refuses (got ${out.kind}) — committing here would delete 8 published jobs ` +
      "and the site-level drop guard would not notice, 29 of 37 being well over half",
  );
  if (out.kind === "soft_fail") {
    assert(out.failureCategory === LISTING_URL_EMPTY, "categorised as listing_url_empty");
    assert(out.error.includes(HQ) && out.error.includes("had 8"), "and names the page and its count");
  }
});

check("a page that collapses to a fraction -> refuse", () => {
  const out = decide([res(STORES, 28), res(HQ, 3)], {
    previous: { [STORES]: 28, [HQ]: 8 },
    scheduled: true,
  });
  assert(out.kind === "soft_fail", "3 of 8 is below the keep ratio");
});

check("a small page dropping is not a collapse", () => {
  assert(DEFAULT_LISTING_DROP_THRESHOLDS.minPrevious === 5, "minPrevious is per-page, not the site's 10");
  const out = decide([res(STORES, 28), res(HQ, 1)], {
    previous: { [STORES]: 28, [HQ]: 4 },
    scheduled: true,
  });
  assert(
    out.kind === "persist",
    "a page with fewer than minPrevious rows has too little history to judge a real drop",
  );
});

check("a page that has always been empty -> persist, but say so", () => {
  const out = decide([res(STORES, 28), res(HQ, 0)], {
    previous: { [STORES]: 28 },
    scheduled: true,
  });
  assert(out.kind === "persist", "no baseline to refuse against on a page's first run");
  if (out.kind === "persist") {
    assert(
      out.warnings.some((w) => w.startsWith(`${LISTING_URL_EMPTY}: ${HQ}`)),
      "but an empty page is always named in the warnings",
    );
  }
});

check("a MANUAL run still commits a dark page — the operator's override", () => {
  // scheduledRun.ts: the manual path deliberately writes a collapse, because an
  // operator who knows a drop is real accepts it by scraping by hand. Without
  // this there is no way at all to publish a company that has emptied out.
  const out = decide([res(STORES, 28), res(HQ, 0)], {
    previous: { [STORES]: 28, [HQ]: 8 },
    scheduled: false,
  });
  assert(out.kind === "persist", `a manual run is informed consent (got ${out.kind})`);
});

// ---------------------------------------------------------------------------
// The decision — a page dropped from the config
// ---------------------------------------------------------------------------

check("rows from an unconfigured page -> scheduled refuses, manual proceeds", () => {
  // The extension's Save rebuilds _meta from seven keys and drops the rest, so
  // listingUrls can vanish without anyone touching it.
  const scheduled = decide([res(STORES, 28)], {
    targets: [STORES],
    previous: { [STORES]: 28, [HQ]: 8, [LOGI]: 1 },
    scheduled: true,
  });
  assert(
    scheduled.kind === "soft_fail",
    `an unattended run must not silently drop two departments (got ${scheduled.kind})`,
  );
  if (scheduled.kind === "soft_fail") {
    assert(scheduled.failureCategory === LISTING_URLS_REMOVED, "categorised as listing_urls_removed");
    assert(scheduled.error.includes(HQ) && scheduled.error.includes(LOGI), "naming both pages");
  }

  const manual = decide([res(STORES, 28)], {
    targets: [STORES],
    previous: { [STORES]: 28, [HQ]: 8 },
    scheduled: false,
  });
  assert(
    manual.kind === "persist",
    "a manual run is how an operator retires a page deliberately",
  );
  if (manual.kind === "persist") {
    assert(
      manual.warnings.some((w) => w.startsWith(LISTING_URLS_REMOVED)),
      "and it still records what it dropped",
    );
  }
});

check("untagged history never looks like a removed page", () => {
  const out = decide([res(STORES, 28)], {
    targets: [STORES],
    previous: { "": 28 },
    scheduled: true,
  });
  assert(
    out.kind === "persist",
    "the first run after this ships has only untagged rows and must not refuse",
  );
});

// ---------------------------------------------------------------------------
// The happy path, and what a single-page site sees
// ---------------------------------------------------------------------------

check("all pages healthy -> persist with a per-page count", () => {
  const out = decide([res(STORES, 28), res(HQ, 8), res(LOGI, 1)], {
    previous: { [STORES]: 28, [HQ]: 8, [LOGI]: 1 },
  });
  assert(out.kind === "persist", `everything healthy persists (got ${out.kind})`);
  if (out.kind === "persist") {
    const line = out.warnings.find((w) => w.startsWith("per_url_counts:"));
    assert(!!line, "a multi-page run reports its per-page counts");
    assert(
      !!line && line.includes(`${HQ}=8/8`),
      `saved/seen per page, so a cross-page dedup collapse is attributable (got ${line})`,
    );
  }
});

check("a single-page site gains nothing", () => {
  const out = decide([res(SITE, 12)], { previous: { [SITE]: 12 } });
  assert(out.kind === "persist", "persists");
  if (out.kind === "persist") {
    assert(
      !out.warnings.some((w) => w.startsWith("per_url_counts:")),
      "and adds NO per_url_counts line — 144 sites would otherwise warn every night",
    );
  }
});

// ---------------------------------------------------------------------------
// The whole fleet is single-page. NOTHING here may change what it does.
// ---------------------------------------------------------------------------

check("REGRESSION: a one-page site is never refused by this module", () => {
  for (const scheduled of [true, false]) {
    const how = scheduled ? "scheduled" : "manual";

    // Emptied out entirely. Already `empty_results` further down the scrape;
    // relabelling it here would change the category the whole fleet reports.
    const gone = decide([res(SITE, 0)], { previous: { [SITE]: 28 }, scheduled });
    assert(gone.kind === "persist", `${how}: 28 -> 0 stays the caller's empty_results`);
    assert(
      gone.kind === "persist" && gone.warnings.length === 0,
      `${how}: and carries no warnings of its own`,
    );

    // Collapsed. Already the site-level isSuspiciousDrop on the scheduled path,
    // and a deliberate commit on the manual one. Two guards on one condition,
    // with different thresholds, is how a fleet-wide behaviour change sneaks in.
    const collapsed = decide([res(SITE, 3)], { previous: { [SITE]: 28 }, scheduled });
    assert(
      collapsed.kind === "persist",
      `${how}: 28 -> 3 is the site-level guard's call, not this module's`,
    );

    // Healthy.
    const ok = decide([res(SITE, 28)], { previous: { [SITE]: 28 }, scheduled });
    assert(ok.kind === "persist" && ok.warnings.length === 0, `${how}: a normal run is untouched`);
  }
});

check("saved counts override item counts in the report", () => {
  // A job listed on two pages is deduped once, across pages.
  const out = decideListingOutcome({
    perUrl: [res(STORES, 28), res(HQ, 8)],
    targets: [{ url: STORES }, { url: HQ }],
    previous: new Map([[STORES, 28], [HQ, 8]]),
    scheduled: true,
    savedByUrl: new Map([[STORES, 28], [HQ, 7]]),
  });
  if (out.kind === "persist") {
    const line = out.warnings.find((w) => w.startsWith("per_url_counts:")) ?? "";
    assert(line.includes(`${HQ}=7/8`), `a collapse shows as saved<seen (got ${line})`);
  } else {
    assert(false, `expected persist, got ${out.kind}`);
  }
});

// ---------------------------------------------------------------------------
// Time budget
// ---------------------------------------------------------------------------

check("listingBudgetExhausted", () => {
  const T = 900_000;
  const R = 120_000;
  assert(!listingBudgetExhausted(0, 0, T, R), "fresh run has budget");
  assert(!listingBudgetExhausted(0, T - R, T, R), "exactly at the reserve is still allowed");
  assert(
    listingBudgetExhausted(0, T - R + 1, T, R),
    "past the reserve stops — the outer timer deletes the site's jobs on a manual run",
  );
});

check("the raw-record tag matches the key spelled out in scrape.ts's SQL", () => {
  // readPreviousListingCounts reads `"rawData"->>'_listingUrl'` as a literal,
  // because `->>` is overloaded and that query cannot be run locally. Renaming
  // the constant without the SQL would lose every baseline in silence: no
  // error, just a guard that stops guarding.
  assert(
    LISTING_URL_TAG === "_listingUrl",
    `the tag is spelled into worker/jobs/scrape.ts — change both or neither (got ${LISTING_URL_TAG})`,
  );
});

check("the soft categories are the three the sweep must know", () => {
  assert(LISTING_SOFT_CATEGORIES.length === 3, "three categories");
  for (const c of [LISTING_URL_FAILED, LISTING_URL_EMPTY, LISTING_URLS_REMOVED]) {
    assert(
      (LISTING_SOFT_CATEGORIES as readonly string[]).includes(c),
      `${c} is exported for sweepSelection`,
    );
  }
});

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("ALL PASS");
