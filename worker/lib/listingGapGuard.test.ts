// Run: npx tsx worker/lib/listingGapGuard.test.ts
//
// Rule B' of the guard gap (owner, 2026-10-10): a scheduled write is refused
// when listing_vs_saved_gap exceeds 25% of the cards, the stored count is at
// least 10, and the run saved fewer than 90% of the stored count. tnuva
// (110 stored, 100 cards, 60 saved) and avivim-hr (27 stored, 27 cards, 15 saved)
// both committed under the 50% count line; dreamjobs' standing gap (about 540
// cards, 365 saved, nothing lost) must not be refused.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DROP_THRESHOLDS,
  LISTING_GAP_RATIO,
  LISTING_GAP_MIN_STORED,
  LISTING_GAP_SAVED_RATIO,
  isListingGapDrop,
  planScheduledPersist,
} from "./scheduledRun";
import { needsAttention } from "./sweepReport";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const NO_WALK = { paginationTruncated: false };
const fill = (pf: number, pt: number, nf: number, nt: number) => ({
  description: { previous: { filled: pf, total: pt }, next: { filled: nf, total: nt } },
});
const plan = (saved: number, stored: number, f: ReturnType<typeof fill>, cardsSeen: number | null, deadDetailPages = 0) =>
  planScheduledPersist(saved, stored, DEFAULT_DROP_THRESHOLDS, NO_WALK, f, { cardsSeen, deadDetailPages });

assert(LISTING_GAP_RATIO === 0.25 && LISTING_GAP_MIN_STORED === 10 && LISTING_GAP_SAVED_RATIO === 0.9, "the rule's three numbers");

// tnuva, 2026-10-10: 110 stored, 100 cards, 60 saved, fill 100% -> 67%.
{
  const p = plan(60, 110, fill(110, 110, 40, 60), 100);
  assert(p.mode === "suspicious_drop" && p.reason === "listing_gap", `tnuva-shaped is refused by the listing gap (got ${p.mode}${p.mode === "suspicious_drop" ? "/" + p.reason : ""})`);
  if (p.mode === "suspicious_drop" && p.reason === "listing_gap") {
    assert(p.cardsSeen === 100 && p.unaccounted === 40 && p.rowCount === 60 && p.previousCount === 110, "with cards, unaccounted, saved and stored on the plan");
  }
}
// avivim-hr, 2026-10-06: 27 stored, 27 cards, 15 saved, fill unchanged.
{
  const p = plan(15, 27, fill(27, 27, 15, 15), 27);
  assert(p.mode === "suspicious_drop" && p.reason === "listing_gap", `avivim-shaped is refused by the listing gap (got ${p.mode})`);
}
// dreamjobs: a standing gap, nothing lost.
assert(plan(365, 360, fill(360, 360, 365, 365), 540).mode === "commit", "dreamjobs-shaped standing gap (540 cards, 365 saved, 360 stored) is written");
// iec: turnover, no gap.
assert(plan(29, 30, fill(30, 30, 29, 29), 29).mode === "commit", "iec-shaped turnover (30 stored, 29 saved, no gap) is written");

// The boundaries, on the plain function.
assert(!isListingGapDrop({ cardsSeen: 100, deadDetailPages: 0 }, 75, 100), "a gap of exactly 25% is not refused");
assert(isListingGapDrop({ cardsSeen: 100, deadDetailPages: 0 }, 74, 100), "26% with 74 of 100 saved is refused");
assert(!isListingGapDrop({ cardsSeen: 100, deadDetailPages: 0 }, 70, 77), "a gap with saved at 90% of stored or more is not refused (70 >= 69.3)");
assert(!isListingGapDrop({ cardsSeen: 9, deadDetailPages: 0 }, 2, 9), "a stored count under 10 is not judged");
assert(!isListingGapDrop({ cardsSeen: null, deadDetailPages: 0 }, 60, 110), "no card count: no verdict");
assert(!isListingGapDrop({ cardsSeen: 100, deadDetailPages: 40 }, 60, 110), "dead detail pages are accounted for, as in the gap warning");

// The report names the rule and the numbers.
{
  const lines = needsAttention(
    { id: "s", startedAt: new Date("2026-10-10T23:00:00Z") } as never,
    [
      {
        siteId: "t",
        siteUrl: "https://www.tnuva.co.il/jobs/",
        phase: "scrape",
        outcome: "suspicious_drop",
        failureCategory: "suspicious_drop",
        jobsBefore: 110,
        jobsAfter: 110,
        scrapedCount: 60,
        warnings: ["listing_gap_drop: 100 card(s) on the listing, 60 saved, 110 stored (40 unaccounted, 40% of the cards)"],
      } as never,
    ],
  );
  const why = lines[0]?.why ?? "";
  assert(
    why === "listing gap refused: 100 card(s) on the listing, 60 saved, 110 stored (40 unaccounted, 40% of the cards) — nothing written, 110 listing(s) kept",
    `the Needs-attention line names the rule and the numbers (got "${why}")`,
  );
}

// The wiring: scrape.ts hands the card count and the dead pages to the plan, and records the warning.
{
  const scrape = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  assert(/cardsSeen: context\.listingItemsSeen \?\? null,\s*deadDetailPages: countDeadDetailPages\(rawFieldsList\)/.test(scrape), "scrape.ts passes the cards seen and the dead pages to planScheduledPersist");
  assert(/listing_gap_drop: /.test(scrape), "and records a listing_gap_drop warning on the refusal");
  const src = readFileSync(join(__dirname, "scheduledRun.ts"), "utf8");
  assert(/25% of the cards/.test(src.slice(0, src.indexOf("export function planScheduledPersist"))), "scheduledRun.ts states the rule in its doc comment");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("listingGapGuard: all assertions passed");
