// Run: npx tsx worker/lib/paginationGuard.test.ts
//
// A scheduled run must not persist a listing walk that stopped short of pages
// the site still offered. Two halves: the rule (isTruncatedWalk), and the plan
// that acts on it (planScheduledPersist), which must refuse such a walk however
// the counts compare — 2026-09-24's 57 -> 30 cleared the ratio guard.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPaginationTruncated, isTruncatedWalk, newPaginationWalk, type PaginationWalk } from "./paginationGuard";
import { planScheduledPersist } from "./scheduledRun";

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
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}
const walk = (pageCounts: number[], stoppedBy: PaginationWalk["stoppedBy"]): PaginationWalk => ({
  pageCounts,
  stoppedBy,
});

check("the rule", () => {
  // ashtrom, 2026-09-24 06:21: two full pages, next offered, page never moved.
  assert(isTruncatedWalk(walk([15, 15], "stalled")), "ashtrom's night — [15,15] then a stall — is truncated");
  assert(isTruncatedWalk(walk([15, 15, 15], "stalled")), "a stall after three full pages is truncated");
  assert(isTruncatedWalk(walk([10, 15, 15], "stalled")), "a last page at least as full as the first is full");

  // The walks that are whole.
  assert(!isTruncatedWalk(walk([15, 15, 15, 6], "end")), "ashtrom today — ends on a disabled next — is whole");
  assert(!isTruncatedWalk(walk([15, 15], "end")), "a walk the listing ended is whole, full pages or not");

  // A stall on a PARTIAL last page is how an inert-but-enabled next button
  // looks on the real last page. Refusing it would freeze such a site forever.
  assert(!isTruncatedWalk(walk([15, 15, 6], "stalled")), "a stall on a partial last page is the end of the listing");
  assert(!isTruncatedWalk(walk([15, 14], "stalled")), "one item short of full is partial");

  // One page gives no page size to compare against. Deliberately not flagged:
  // the undersize guard is what covers a first-page stall.
  assert(!isTruncatedWalk(walk([15], "stalled")), "a first-page stall has no page size, so it is not this rule's call");

  // Not this guard's business.
  assert(!isTruncatedWalk(walk([15, 15], "maxPages")), "maxPages is the config's own bound");
  assert(!isTruncatedWalk(walk([15, 15], "aborted")), "the deadline refuses persistence on its own");
  assert(!isTruncatedWalk(null), "no pagination configured, nothing to judge");
  assert(!isTruncatedWalk(newPaginationWalk()), "a walk that never ran is not truncated");
  assert(!isTruncatedWalk(walk([0, 0], "stalled")), "empty pages are not full ones");
});

check("the plan refuses a truncated walk", () => {
  const p = planScheduledPersist(30, 57, undefined, { paginationTruncated: true });
  assert(p.mode === "suspicious_drop", `57 -> 30 on a truncated walk refuses (got ${p.mode})`);
  assert(
    p.mode === "suspicious_drop" && p.reason === "pagination_truncated",
    "and says why, since the ratio alone would have committed it",
  );
  assert(
    planScheduledPersist(30, 57).mode === "commit",
    "the same counts on a whole walk still commit — the ratio guard is unchanged",
  );
  assert(
    planScheduledPersist(60, 57, undefined, { paginationTruncated: true }).mode === "suspicious_drop",
    "growth does not excuse a truncated walk: its unread pages would still be deleted",
  );
  assert(
    planScheduledPersist(4, 5, undefined, { paginationTruncated: true }).mode === "suspicious_drop",
    "nor does a site under the ratio guard's minimum",
  );
  assert(
    planScheduledPersist(30, 0, undefined, { paginationTruncated: true }).mode === "commit",
    "a site with nothing stored loses nothing, so its first partial walk commits",
  );
  const r = planScheduledPersist(8, 433);
  assert(r.mode === "suspicious_drop" && r.reason === "ratio", "the ratio refusal names itself too");
  assert(
    planScheduledPersist(0, 57, undefined, { paginationTruncated: true }).mode === "empty",
    "empty still wins",
  );
});

check("a first-page stall, judged against what the site has stored", () => {
  // ashtrom, 2026-09-27 rehearsal: page 1 showed 15 cards, the click on an
  // enabled "next" never moved the page, and 30 listings were stored. The
  // rule above cannot judge one page (no page size), and the ratio guard lets
  // 15 of 30 through (not below half) — so the run would have committed 15 and
  // deleted 15 live listings.
  const ashtrom = walk([15], "stalled");
  assert(isPaginationTruncated([ashtrom], 30), "15 seen on a stalled first page, 30 stored -> refused");
  assert(
    planScheduledPersist(15, 30, undefined, { paginationTruncated: isPaginationTruncated([ashtrom], 30) }).mode ===
      "suspicious_drop",
    "and the plan refuses it — the ratio guard alone commits exactly this",
  );
  assert(planScheduledPersist(15, 30).mode === "commit", "(which is what it did before this rule)");

  // Where it must not fire.
  assert(!isPaginationTruncated([ashtrom], 15), "stored equal to what page 1 showed: nothing to lose");
  assert(!isPaginationTruncated([ashtrom], 10), "stored fewer: the site grew, nothing to lose");
  assert(!isPaginationTruncated([ashtrom], 0), "nothing stored: a first run loses nothing");
  assert(!isPaginationTruncated([walk([15], "end")], 30), "a first page the listing ENDED is the ratio guard's call");
  assert(!isPaginationTruncated([walk([15], "maxPages")], 30), "maxPages 1 is the config's own bound");
  assert(!isPaginationTruncated([walk([15], "aborted")], 30), "the deadline refuses on its own");
  assert(!isPaginationTruncated([], 30), "no pagination configured");

  // The multi-page rule is unchanged, and either rule refuses.
  assert(isPaginationTruncated([walk([15, 15], "stalled")], 0), "a stall on a full later page is still truncated");
  assert(!isPaginationTruncated([walk([15, 6], "stalled")], 30), "a stall on a partial later page is still the end");
  assert(
    isPaginationTruncated([walk([15, 15, 15, 6], "end"), walk([15], "stalled")], 60),
    "any walk refusing refuses the run",
  );
});

check("scrape.ts records the walk and hands it to the plan", () => {
  const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const calls = src.split("await advanceToNextPage(").length - 1;
  assert(calls === 2, `both paging loops call advanceToNextPage (found ${calls})`);
  assert(!/const advanced = await advanceToNextPage\(/.test(src), "no caller reduces the outcome to a boolean");
  const recorded = src.split("walk.stoppedBy = outcome").length - 1;
  assert(recorded === 2, `both loops record why they stopped (found ${recorded})`);
  assert(
    /planScheduledPersist\(rows\.length, previousCount, \{[\s\S]*?\}, \{\s*paginationTruncated: isPaginationTruncated\(runMode\.walks, previousCount\)/.test(src),
    "the scheduled persist plan is given the walk's verdict",
  );
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("paginationGuard: a walk that stopped short of offered pages is never persisted unattended");
